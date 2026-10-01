'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const {MMA2Restart} = require('../mma2-restart');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcs-restart-test-'));
  let restarts = 0;
  const watcher = new MMA2Restart({root, runtime: {restart: async key => { assert.equal(key, 'mma2'); restarts++; }}, ready: async () => {}, ...overrides});
  fs.mkdirSync(watcher.directory, {recursive: true});
  const config = 'listeners: []\n';
  const hash = crypto.createHash('sha256').update(config).digest('hex');
  fs.writeFileSync(watcher.config, config);
  const request = (stamp = 'first') => fs.writeFileSync(watcher.request, yaml.dump({requested_at: stamp, config_sha256: hash, ports: []}));
  request();
  watcher.active = true;
  t.after(async () => {
    await watcher.stop();
    // This exact directory was allocated by mkdtemp for this test.
    fs.rmSync(root, {recursive: true, force: true});
  });
  return {watcher, hash, request, restarts: () => restarts};
}

test('ack waits for MMA2 readiness and includes the matching config fingerprint', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const {watcher, hash, restarts} = fixture(t, {ready: () => gate});
  const pending = watcher.poll();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restarts(), 1);
  assert.equal(fs.existsSync(watcher.ack), false);
  release(); await pending;
  assert.equal(fs.readFileSync(watcher.ack, 'utf8'), hash);
  await watcher.poll();
  assert.equal(restarts(), 1);
});

test('failed startup/readiness never writes an acknowledgement', async t => {
  const {watcher} = fixture(t, {ready: async () => { throw new Error('MMA2 exited'); }});
  await assert.rejects(watcher.poll(), /MMA2 exited/);
  assert.equal(fs.existsSync(watcher.ack), false);
});


test('failed readiness is retried without requiring another config save', async t => {
  let attempts = 0;
  const {watcher, hash, restarts} = fixture(t, {ready: async () => {
    attempts++;
    if (attempts === 1) throw new Error('temporary readiness failure');
  }});
  await assert.rejects(watcher.poll(), /temporary readiness failure/);
  assert.equal(fs.existsSync(watcher.ack), false);
  await watcher.poll();
  assert.equal(restarts(), 2);
  assert.equal(attempts, 2);
  assert.equal(fs.readFileSync(watcher.ack, 'utf8'), hash);
});
test('changed configuration is not acknowledged as the original request', async t => {
  const {watcher} = fixture(t);
  watcher.ready = async () => fs.writeFileSync(watcher.config, 'debug: true\n');
  await assert.rejects(watcher.poll(), /changed during/);
  assert.equal(fs.existsSync(watcher.ack), false);
});

test('mismatched request hash never restarts a process', async t => {
  const {watcher, restarts} = fixture(t);
  fs.writeFileSync(watcher.config, 'debug: true\n');
  await assert.rejects(watcher.poll(), /does not match/);
  assert.equal(restarts(), 0);
});

test('a later apply with identical configuration still gets a fresh restart', async t => {
  const {watcher, request, restarts} = fixture(t);
  await watcher.poll();
  fs.unlinkSync(watcher.ack);
  request('second');
  await watcher.poll();
  assert.equal(restarts(), 2);
  assert.equal(fs.existsSync(watcher.ack), true);
});

test('shutdown during reload drains the operation without acknowledging', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const {watcher} = fixture(t, {ready: () => gate});
  const pending = watcher.poll();
  await new Promise(resolve => setImmediate(resolve));
  const stopping = watcher.stop();
  release();
  await Promise.all([pending, stopping]);
  assert.equal(fs.existsSync(watcher.ack), false);
});
