'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const {PortableRuntime} = require('../portable-runtime');
const {MMA2Restart} = require('../mma2-restart');
const {callReplicatorRuntime} = require('../replicator-runtime');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assertPipeFree = name => new Promise((resolve, reject) => {
  const socket = net.createConnection('\\\\.\\pipe\\' + name);
  socket.setTimeout(1000);
  socket.once('connect', () => { socket.destroy(); reject(new Error(name + ' is already in use; refusing live test')); });
  socket.once('error', error => error.code === 'ENOENT' ? resolve() : reject(error));
  socket.once('timeout', () => { socket.destroy(); reject(new Error('Pipe check timed out')); });
});

(async () => {
  await assertPipeFree('mcs-modbus-simulator');
  await assertPipeFree('mcs-modbus-replicator');
  const output = path.join(__dirname, '..', 'dist');
  fs.mkdirSync(output, {recursive: true});
  const root = fs.mkdtempSync(path.join(output, 'runtime-smoke-'));
  const config = path.join(root, 'config', 'mma2', 'config.yaml');
  fs.mkdirSync(path.dirname(config), {recursive: true});
  fs.writeFileSync(config, '{}\n');
  const logs = [];
  const record = (...entry) => { logs.push(entry); if (logs.length > 20) logs.shift(); };
  const runtime = new PortableRuntime({root, bin: path.join(__dirname, '..', 'bin'),
    specs: [
      {key: 'mma2', file: 'mma2.exe', args: [config]},
      {key: 'simulator', file: 'modbus-simulator-runtime.exe'},
      {key: 'replicator', file: 'modbus-replicator-runtime.exe'}
    ], log: record});
  const restart = new MMA2Restart({root, runtime, log: text => record('restart', text)});
  const source = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 12) {
        const length = 6 + buffer.readUInt16BE(4);
        if (buffer.length < length) return;
        const request = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        const count = request.readUInt16BE(10);
        const response = Buffer.alloc(9 + 2 * count);
        request.copy(response, 0, 0, 4);
        response.writeUInt16BE(3 + 2 * count, 4);
        response[6] = request[6]; response[7] = 3; response[8] = count * 2;
        for (let index = 0; index < count; index++) response.writeUInt16BE(42 + index, 9 + 2 * index);
        socket.write(response);
      }
    });
  });
  try {
    assert.equal(runtime.startAll(), true);
    restart.start();
    await delay(1500);
    assert.deepEqual(Object.values(runtime.status()), ['RUNNING', 'RUNNING', 'RUNNING'], JSON.stringify(logs).slice(-3000));
    const response = await callReplicatorRuntime(root, 'load', {}, 3000);
    assert.ok(response.document, 'Replicator load response');
    await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const destinationPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const document = {devices: [{name: 'portable-restart-test', enabled: true,
      endpoint: '127.0.0.1:' + source.address().port, unit_id: 1,
      pull_blocks: [{function: 3, start: 0, count: 1, scan_rate_ms: 100}],
      destination: {port: destinationPort, unit_id: 1, auto_port: false, auto_unit_id: false}}]};
    const originalMMA2 = runtime.children.get('mma2').pid;
    await callReplicatorRuntime(root, 'apply', {document});
    assert.notEqual(runtime.children.get('mma2').pid, originalMMA2, 'Apply restarts MMA2');
    const firstMMA2 = runtime.children.get('mma2').pid;
    // A second apply with unchanged structure must also receive a fresh ack.
    await callReplicatorRuntime(root, 'apply', {document});
    assert.notEqual(runtime.children.get('mma2').pid, firstMMA2);
    const loaded = await callReplicatorRuntime(root, 'load');
    assert.equal(loaded.document.devices[0].name, 'portable-restart-test');
    let status;
    for (let attempt = 0; attempt < 40; attempt++) {
      status = await callReplicatorRuntime(root, 'status', {name: 'portable-restart-test'});
      if (JSON.stringify(status).includes('42')) break;
      await delay(100);
    }
    // Read real MMA2 memory over Modbus, independently of runtime status labels.
    const value = await new Promise((resolve, reject) => {
      const socket = net.createConnection({host: '127.0.0.1', port: destinationPort});
      let buffer = Buffer.alloc(0);
      socket.setTimeout(2000);
      socket.once('connect', () => socket.write(Buffer.from([0,1,0,0,0,6,1,3,0,0,0,1])));
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length >= 11) { socket.destroy(); resolve(buffer.readUInt16BE(9)); }
      });
      socket.once('error', reject);
      socket.once('timeout', () => { socket.destroy(); reject(new Error('Modbus read timed out')); });
    });
    assert.equal(value, 42, 'Replicated value reaches MMA2 after Save & Apply');
    await restart.stop();
    await runtime.stopAll();
    assert.equal(runtime.children.size, 0);
    const result = {passed: true, root, status: runtime.status(), replicatorLoad: loaded, appliedTwice: true, modbusValue: value, logs};
    fs.writeFileSync(path.join(output, 'runtime-smoke-result.json'), JSON.stringify(result, null, 2));
    console.log('PASS: real backends, two Save & Apply transactions, MMA2 restarts, persisted device, Modbus readback=42, and owned-process cleanup.');
  } finally {
    await restart.stop();
    await runtime.stopAll();
    if (source.listening) await new Promise(resolve => source.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
