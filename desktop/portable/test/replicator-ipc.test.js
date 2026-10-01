'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {createReplicatorCall} = require('../replicator-ipc');

test('status returns the real runtime result', async () => {
  const expected = {
    name: 'PLC-01',
    running: true,
    source_status: 'OK',
    last_poll: '2026-09-17T01:02:03Z',
    blocks: [{index: 0, running: true, cycles: 4, source_status: 'OK'}]
  };
  const calls = [];
  const call = createReplicatorCall({
    load: () => ({devices: []}),
    apply: document => ({document}),
    status: payload => {
      calls.push(payload);
      return expected;
    }
  });
  assert.deepEqual(await call('status', {name: 'PLC-01'}), expected);
  assert.deepEqual(calls, [{name: 'PLC-01'}]);
});

test('runtime-unavailable status rejects instead of reporting health', async () => {
  const call = createReplicatorCall({
    load: () => ({devices: []}),
    apply: document => ({document}),
    status: async () => {
      throw Object.assign(new Error('connect ENOENT named pipe'), {code: 'ENOENT'});
    }
  });
  await assert.rejects(call('status', {name: 'PLC-01'}), /ENOENT/);
});

test('load and apply await the live transaction handlers', async () => {
  const document = {devices: [{name: 'PLC-01'}]};
  const call = createReplicatorCall({
    load: async () => document,
    apply: async value => ({document: value, message: 'applied'}),
    status: () => ({})
  });
  assert.deepEqual(await call('load'), {document});
  assert.deepEqual(await call('apply', {document}), {document, message: 'applied'});
  await assert.rejects(call('unknown'), /Unsupported Replicator operation/);
});