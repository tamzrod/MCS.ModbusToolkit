'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const VERSION = 1;
const MAX_MESSAGE = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 25000;
const OPERATIONS = new Set(['load', 'apply', 'status', 'suggest']);

const runtimeSocketPath = root => typeof root === 'string' && root.startsWith('\\\\.\\pipe\\')
  ? root
  : '\\\\.\\pipe\\mcs-modbus-replicator';

// Match replicator/runtime_api.go and cmd/modbus-replicator-runtime/main.go.
// The runtime uses one 4-byte big-endian length followed by one JSON response.
const callReplicatorRuntime = (root, operation, payload = {}, timeoutMS = DEFAULT_TIMEOUT_MS) => {
  if (typeof root !== 'string' || !root) return Promise.reject(new Error('Replicator data root is required'));
  if (!OPERATIONS.has(operation)) return Promise.reject(new Error(`Unsupported Replicator operation ${operation}`));
  if (!Number.isFinite(timeoutMS) || timeoutMS <= 0) return Promise.reject(new Error('Invalid Replicator timeout'));

  const requestID = crypto.randomUUID();
  const body = Buffer.from(JSON.stringify({version: VERSION, request_id: requestID, operation, payload}));
  if (body.length < 1 || body.length > MAX_MESSAGE) return Promise.reject(new Error('Replicator request exceeds maximum size'));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(runtimeSocketPath(root));
    let settled = false;
    let chunks = [];
    let received = 0;
    let expected = null;
    const timer = setTimeout(() => socket.destroy(new Error('Replicator runtime request timed out')), timeoutMS);

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    socket.on('connect', () => socket.write(Buffer.concat([header, body])));
    socket.on('data', chunk => {
      received += chunk.length;
      if (received > MAX_MESSAGE + 4) return finish(new Error('Replicator response exceeds maximum size'));
      chunks.push(chunk);
      const data = Buffer.concat(chunks, received);
      if (expected === null && received >= 4) {
        expected = data.readUInt32BE(0);
        if (expected < 1 || expected > MAX_MESSAGE) return finish(new Error('Invalid Replicator response length'));
      }
      if (expected === null || received < expected + 4) return;
      if (received !== expected + 4) return finish(new Error('Replicator response has trailing data'));

      let response;
      try {
        response = JSON.parse(data.subarray(4).toString('utf8'));
      } catch (error) {
        return finish(new Error('Invalid Replicator response JSON', {cause: error}));
      }
      if (!response || response.version !== VERSION || response.request_id !== requestID || typeof response.ok !== 'boolean') {
        return finish(new Error('Mismatched Replicator runtime response'));
      }
      if (!response.ok) {
        const message = response.error && response.error.message || 'Replicator runtime operation failed';
        return finish(new Error(message));
      }
      finish(null, response.result);
    });
    socket.on('error', error => finish(error));
    socket.on('end', () => finish(new Error('Replicator runtime closed before complete response')));
    socket.on('close', () => finish(new Error('Replicator runtime disconnected before complete response')));
  });
};

const applyReplicatorRuntime = async (root, document, call = callReplicatorRuntime) => {
  if ((document.devices || []).some(device => Object.keys(device.mma2_advanced || {}).length)) {
    const loaded = await call(root, 'load');
    if (!loaded.capabilities?.mma2_advanced) throw new Error('Update and restart the Replicator backend before saving Advanced Settings.');
  }
  return call(root, 'apply', {document});
};

module.exports = {callReplicatorRuntime, runtimeSocketPath, applyReplicatorRuntime};
