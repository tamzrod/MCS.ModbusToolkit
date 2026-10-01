'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PortableRuntime} = require('../portable-runtime');

function fixture(options = {}) {
  const spawned = [];
  const stopped = [];
  const logs = [];
  const runtime = new PortableRuntime({
    specs: [{key: 'mma2', file: 'mma2.exe'}, {key: 'simulator', file: 'simulator.exe'}, {key: 'replicator', file: 'replicator.exe'}],
    bin: '/payload', root: '/portable/data', exists: () => true, timeout: 10,
    log: (...args) => logs.push(args),
    spawnProcess: (file, args, options) => {
      const child = new EventEmitter();
      child.pid = 100 + spawned.length;
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = signal => { stopped.push({file, signal}); queueMicrotask(() => child.emit('exit', 0, signal)); return true; };
      spawned.push({file, args, options, child});
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }, ...options
  });
  return {runtime, spawned, stopped, logs};
}

test('missing payload prevents partial startup and names missing backend', () => {
  const {runtime, spawned, logs} = fixture({exists: file => !file.endsWith('mma2.exe')});
  assert.equal(runtime.startAll(), false);
  assert.equal(spawned.length, 0);
  assert.equal(runtime.status().mma2, 'MISSING BINARY');
  assert.match(logs[0][2], /mma2.exe/);
});

test('start owns three hidden children with portable cwd/env; repeated start is idempotent', async () => {
  const {runtime, spawned, stopped} = fixture();
  runtime.startAll(); runtime.startAll();
  await Promise.resolve();
  assert.equal(spawned.length, 3);
  assert.deepEqual(Object.values(runtime.status()), ['RUNNING', 'RUNNING', 'RUNNING']);
  for (const {options} of spawned) {
    assert.equal(options.cwd, '/portable/data');
    assert.equal(options.env.MCS_DATA_ROOT, '/portable/data');
    assert.equal(options.env.OSJS_DATA_DIR, '/portable/data');
    assert.equal(options.windowsHide, true);
  }
  const stopping = runtime.stopAll();
  assert.equal(runtime.stopAll(), stopping);
  assert.equal(runtime.startAll(), false);
  await stopping;
  assert.deepEqual(stopped.map(item => /([^/\\]+)$/.exec(item.file)[1]), ['replicator.exe', 'simulator.exe', 'mma2.exe']);
  assert.equal(runtime.children.size, 0);
});

test('unexpected exit is not healthy and restart starts only the missing child', async () => {
  const {runtime, spawned} = fixture();
  runtime.startAll(); await Promise.resolve();
  spawned[1].child.emit('exit', 2, null);
  assert.equal(runtime.status().simulator, 'EXITED');
  runtime.startAll(); await Promise.resolve();
  assert.equal(spawned.length, 4);
  await runtime.stopAll();
});

test('asynchronous spawn error is captured without retaining a nonexistent process', async () => {
  const {runtime, spawned, logs} = fixture();
  runtime.startAll(); await Promise.resolve();
  spawned[0].child.pid = undefined;
  spawned[0].child.emit('error', new Error('access denied'));
  assert.equal(runtime.status().mma2, 'ERROR');
  assert.equal(runtime.children.has('mma2'), false);
  assert.match(logs[0][2], /access denied/);
  await runtime.stopAll();
});

test('shutdown waits, escalates and retains ownership if child refuses to exit', async () => {
  const {runtime, spawned} = fixture();
  runtime.startAll(); await Promise.resolve();
  const signals = [];
  spawned[2].child.kill = signal => { signals.push(signal); return false; };
  await assert.rejects(runtime.stopAll(), /Could not stop owned replicator/);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(runtime.status().replicator, 'STOP FAILED');
  assert.equal(runtime.children.has('replicator'), true);
  spawned[2].child.emit('exit', 0, null);
  await runtime.stopAll();
});

test('MMA2 restart replaces only its owned child and keeps Replicator available', async () => {
  const {runtime, spawned, stopped} = fixture();
  runtime.startAll(); await Promise.resolve();
  const replicator = runtime.children.get('replicator');
  await runtime.restart('mma2');
  assert.equal(spawned.length, 4);
  assert.equal(stopped.length, 1);
  assert.equal(runtime.children.get('replicator'), replicator);
  assert.equal(runtime.status().mma2, 'RUNNING');
  await runtime.stopAll();
});

test('stop during restart does not relaunch MMA2 or leak owned children', async () => {
  const {runtime, spawned} = fixture();
  runtime.startAll(); await Promise.resolve();
  const restarting = runtime.restart('mma2');
  const stopped = runtime.stopAll();
  await assert.rejects(restarting, /stopping/);
  await stopped;
  assert.equal(spawned.length, 3);
  assert.equal(runtime.children.size, 0);
});
