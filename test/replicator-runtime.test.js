'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {callReplicatorRuntime, runtimeSocketPath} = require('../replicator-runtime');
const {applyReplicatorRuntime} = require('../replicator-runtime');

test('advanced saves reject old backends before sending apply', async () => {
  const document = {devices: [{mma2_advanced: {state_sealing: {enabled: false}}}]};
  const operations = [];
  await assert.rejects(applyReplicatorRuntime('root', document, async (root, operation) => {
    operations.push(operation); return {document: {devices: []}};
  }), /Update and restart/);
  assert.deepEqual(operations, ['load']);
  const result = await applyReplicatorRuntime('root', document, async (root, operation, payload) => {
    if (operation === 'load') return {capabilities: {mma2_advanced: true}};
    return payload;
  });
  assert.deepEqual(result.document, document);
});

const framed = value => {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
};

const serve = async (t, handler) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcs-rep-'));
  await fs.mkdir(path.join(root, 'run'));
  const socketPath = runtimeSocketPath(root) + '-test-' + path.basename(root);
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let received = Buffer.alloc(0);
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 4) return;
      const size = received.readUInt32BE(0);
      if (received.length < size + 4) return;
      handler(socket, JSON.parse(received.subarray(4, size + 4).toString('utf8')));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, {recursive: true, force: true});
  });
  return socketPath;
};

test('status request uses runtime framing and returns the matching result', async t => {
  const root = await serve(t, (socket, request) => {
    assert.equal(request.version, 1);
    assert.equal(request.operation, 'status');
    assert.deepEqual(request.payload, {name: 'PLC-01'});
    assert.ok(request.request_id);
    const response = framed({version: 1, request_id: request.request_id, ok: true, result: {source_status: 'OK'}});
    socket.write(response.subarray(0, 2));
    socket.write(response.subarray(2, 7));
    socket.end(response.subarray(7));
  });
  assert.deepEqual(await callReplicatorRuntime(root, 'status', {name: 'PLC-01'}, 1000), {source_status: 'OK'});
});

test('runtime errors reject with the actual error instead of fabricating health', async t => {
  const root = await serve(t, (socket, request) => {
    socket.end(framed({version: 1, request_id: request.request_id, ok: false, error: {code: 'STATUS_FAILED', message: 'device not found'}}));
  });
  await assert.rejects(callReplicatorRuntime(root, 'status', {name: 'unknown'}, 1000), /device not found/);
});

test('rejects a mismatched request ID', async t => {
  const root = await serve(t, socket => socket.end(framed({version: 1, request_id: 'other-id', ok: true, result: {running: true}})));
  await assert.rejects(callReplicatorRuntime(root, 'status', {}, 1000), /Mismatched/);
});

test('rejects an invalid frame length', async t => {
  const root = await serve(t, socket => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1024 * 1024 + 1);
    socket.end(header);
  });
  await assert.rejects(callReplicatorRuntime(root, 'status', {}, 1000), /response length/);
});

test('rejects truncated response instead of hanging', async t => {
  const root = await serve(t, socket => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(64);
    socket.end(Buffer.concat([header, Buffer.from('{}')]));
  });
  await assert.rejects(callReplicatorRuntime(root, 'status', {}, 1000), /before complete/);
});

test('rejects a response timeout', async t => {
  const root = await serve(t, () => {});
  await assert.rejects(callReplicatorRuntime(root, 'status', {}, 40), /timed out/);
});

test('rejects unavailable socket, unsupported operation and oversized request', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcs-rep-missing-'));
  t.after(() => fs.rm(tempRoot, {recursive: true, force: true}));
  const root = runtimeSocketPath(tempRoot) + '-missing-' + path.basename(tempRoot);
  await assert.rejects(callReplicatorRuntime(root, 'status', {}, 100), /ENOENT/);
  await assert.rejects(callReplicatorRuntime(root, 'destroy', {}, 100), /Unsupported/);
  await assert.rejects(callReplicatorRuntime(root, 'apply', {blob: 'x'.repeat(1024 * 1024)}, 100), /maximum size/);
});
