'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const {PortableRuntime} = require('../portable-runtime');
const {MMA2Restart} = require('../mma2-restart');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for real MMA2 restart acknowledgement');
    await delay(50);
  }
}
(async () => {
  const output = path.join(__dirname, '..', 'dist');
  fs.mkdirSync(output, {recursive: true});
  const root = fs.mkdtempSync(path.join(output, 'mma2-restart-smoke-'));
  const config = path.join(root, 'config', 'mma2', 'config.yaml');
  fs.mkdirSync(path.dirname(config), {recursive: true});
  fs.writeFileSync(config, '{}\n');
  const logs = [];
  const record = (...entry) => { logs.push(entry); if (logs.length > 20) logs.shift(); };
  const runtime = new PortableRuntime({root, bin: path.join(__dirname, '..', 'bin'),
    specs: [{key: 'mma2', file: 'mma2.exe', args: [config]}], log: record});
  const watcher = new MMA2Restart({root, runtime, log: record});
  try {
    assert.equal(runtime.startAll(), true);
    await delay(300);
    assert.equal(runtime.status().mma2, 'RUNNING');
    const originalPID = runtime.children.get('mma2').pid;
    const port = await freePort();
    const body = yaml.dump({listeners: [{id: 'restart-test', listen: '127.0.0.1:' + port,
      memory: [{unit_id: 1, holding_registers: {start: 0, count: 1},
        policy: {rules: [{id: 'local-test', source_ip: ['127.0.0.1'], allow_fc: [3]}]}}]}]});
    fs.writeFileSync(config, body);
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const request = stamp => fs.writeFileSync(watcher.request, yaml.dump({requested_at: stamp, config_sha256: hash, ports: [port]}));
    request('first');
    watcher.start();
    await until(() => fs.existsSync(watcher.ack));
    assert.equal(fs.readFileSync(watcher.ack, 'utf8'), hash);
    assert.notEqual(runtime.children.get('mma2').pid, originalPID);
    const firstPID = runtime.children.get('mma2').pid;
    fs.unlinkSync(watcher.ack);
    request('second');
    await until(() => fs.existsSync(watcher.ack));
    assert.notEqual(runtime.children.get('mma2').pid, firstPID);
    const reply = await new Promise((resolve, reject) => {
      const socket = net.createConnection({host: '127.0.0.1', port});
      let bytes = Buffer.alloc(0);
      socket.setTimeout(2000);
      socket.once('connect', () => socket.write(Buffer.from([0,1,0,0,0,6,1,3,0,0,0,1])));
      socket.on('data', chunk => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length >= 7 && bytes.length >= 6 + bytes.readUInt16BE(4)) { socket.destroy(); resolve(bytes); }
      });
      socket.once('error', reject);
      socket.once('timeout', () => { socket.destroy(); reject(new Error('Modbus response timed out')); });
    });
    assert.equal(reply[7], 3, 'MMA2 answers FC3 after reload');
    assert.equal(reply.readUInt16BE(9), 0);
    await watcher.stop();
    await runtime.stopAll();
    fs.writeFileSync(path.join(output, 'mma2-restart-smoke-result.json'), JSON.stringify({passed: true, root, port, restartedTwice: true, modbusRead: true, logs}, null, 2));
    console.log('PASS: real MMA2 restarted twice, acknowledged matching config, served Modbus FC3, and stopped.');
  } catch (error) {
    console.error(JSON.stringify(logs).slice(-3000));
    throw error;
  } finally { await watcher.stop(); await runtime.stopAll(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
