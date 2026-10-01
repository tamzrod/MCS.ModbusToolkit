'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const yaml = require('js-yaml');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const portReady = port => new Promise(resolve => {
  const socket = net.createConnection({host: '127.0.0.1', port});
  const done = ready => { socket.destroy(); resolve(ready); };
  socket.setTimeout(200);
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
  socket.once('timeout', () => done(false));
});

async function waitReady(runtime, ports, active) {
  // A successful spawn is not evidence that the new configuration loaded.
  await delay(250);
  const deadline = Date.now() + 8000;
  while (active()) {
    if (runtime.status().mma2 !== 'RUNNING') throw new Error('MMA2 exited before restart acknowledgement');
    if ((await Promise.all(ports.map(portReady))).every(Boolean)) return;
    if (Date.now() >= deadline) throw new Error('MMA2 configured ports did not become ready');
    await delay(50);
  }
  throw new Error('MMA2 restart cancelled during shutdown');
}

class MMA2Restart {
  constructor({root, runtime, ready = waitReady, log = () => {}}) {
    this.directory = path.join(root, 'config', 'mma2');
    this.request = path.join(this.directory, 'restart-request.yaml');
    this.config = path.join(this.directory, 'config.yaml');
    this.ack = path.join(this.directory, 'restart-ack');
    Object.assign(this, {runtime, ready, log});
    this.active = false;
    this.pending = null;
    this.last = null;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.last = null;
    const poll = () => { if (!this.pending) void this.poll().catch(error => this.log('MMA2 restart failed: ' + error.message)); };
    this.timer = setInterval(poll, 50);
    void poll();
  }

  async stop() {
    this.active = false;
    clearInterval(this.timer);
    if (this.pending) await this.pending.catch(() => {});
  }

  poll() {
    if (!this.active) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(() => this.consume()).finally(() => { this.pending = null; });
    return this.pending;
  }

  async consume() {
    let body;
    try { body = fs.readFileSync(this.request, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') { this.last = null; return; } throw error; }
    if (body === this.last) return;
    const request = yaml.load(body);
    if (!/^[a-f0-9]{64}$/.test(request?.config_sha256 || '')) throw new Error('Invalid configuration fingerprint');
    const ports = request.ports || [];
    if (!Array.isArray(ports) || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid restart ports');
    if (sha256(fs.readFileSync(this.config)) !== request.config_sha256) throw new Error('Restart request does not match current configuration');
    if (!this.active) return;
    await this.runtime.restart('mma2');
    await this.ready(this.runtime, ports, () => this.active);
    if (!this.active) return;
    if (this.runtime.status && this.runtime.status().mma2 !== 'RUNNING') throw new Error('MMA2 stopped before acknowledgement');
    // Never acknowledge an obsolete request or config overwritten while restarting.
    if (fs.readFileSync(this.request, 'utf8') !== body || sha256(fs.readFileSync(this.config)) !== request.config_sha256) {
      throw new Error('Configuration changed during MMA2 restart');
    }
    const temporary = this.ack + '.tmp';
    fs.writeFileSync(temporary, request.config_sha256);
    fs.renameSync(temporary, this.ack);
    // Mark the request complete only after the matching configuration is ready and acknowledged.
    // Failed validation/restart/readiness attempts remain retryable on the next poll.
    this.last = body;
    this.log('MMA2 restarted and configuration acknowledged');
  }
}

module.exports = {MMA2Restart, waitReady};
