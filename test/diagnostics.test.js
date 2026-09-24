const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {snapshot, inspectPorts, readTail} = require('../diagnostics');

test('port evidence distinguishes missing, unknown, foreign and MMA2 listeners', () => {
  const config = {rbe: {tcp: {listen: ':9001'}}};
  assert.equal(inspectPorts(config, null)[0].state, 'Unavailable');
  assert.equal(inspectPorts(config, [])[0].state, 'Not listening');
  const listener = {address: '0.0.0.0', port: 9001, pid: 123, process: 'mma2'};
  assert.equal(inspectPorts(config, [listener])[0].state, 'MMA2 listener observed');
  assert.equal(inspectPorts(config, [{...listener, process: 'other'}])[0].state, 'Owner needs review');
  assert.equal(inspectPorts(config, [{...listener, process: null}])[0].state, 'Owner needs review');
  assert.equal(inspectPorts({rbe: {tcp: {listen: '127.0.0.1:9001'}}}, [{...listener, address: '192.168.1.1'}])[0].state, 'Not listening');
});

test('snapshot preserves unavailable evidence and flags missing RBE output', async () => {
  const result = await snapshot({root: path.join(os.tmpdir(), 'missing-diagnostic-logs'),
    config: {listeners: [{listen: ':502', memory: [{unit_id: 1, rbe: {coils: [{id: 1}]}}]}]},
    services: {mma2: 'STOPPED'}, listenerQuery: async () => { throw new Error('access denied'); }});
  assert.ok(result.problems.some(item => item.includes('access denied')));
  assert.ok(result.problems.some(item => item.includes('RBE rules exist')));
  assert.equal(result.ports[0].state, 'Unavailable');
  assert.equal(result.logs.length, 6);
  assert.ok(result.logs.every(entry => entry.unavailable));
});

test('isolated review never queries live ports', async () => {
  const result = await snapshot({root: os.tmpdir(), config: {}, services: {}, isolated: true,
    listenerQuery: () => { throw new Error('must not run'); }});
  assert.ok(result.problems[0].includes('Isolated review'));
  assert.equal(result.problems.some(item => item.includes('must not run')), false);
});

test('log tails are bounded and installer captures both service streams', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcs-diagnostics-'));
  try {
    const file = path.join(root, 'test.log');
    fs.writeFileSync(file, 'older\n'.repeat(200) + 'recent error\n');
    const text = readTail(file, 64);
    assert.ok(text.includes('recent error'));
    assert.ok(text.length < 110);
    const installer = fs.readFileSync(path.join(__dirname, '../build/installer.nsh'), 'utf8');
    assert.ok(installer.includes('"AppStdout"'));
    assert.ok(installer.includes('"AppStderr"'));
    assert.ok(installer.includes('"AppRotateBytes" 1048576'));
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
