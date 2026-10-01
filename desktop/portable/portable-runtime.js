'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

// Own child handles, never discover/terminate processes by name or listening port.
class PortableRuntime {
  constructor({specs, bin, root, spawnProcess = spawn, exists = fs.existsSync, log = () => {}, changed = () => {}, timeout = 3000}) {
    Object.assign(this, {specs, bin, root, spawnProcess, exists, log, changed, timeout});
    this.children = new Map();
    this.states = Object.fromEntries(specs.map(spec => [spec.key, 'STOPPED']));
    this.stopping = null;
    this.restarting = null;
  }

  status() { return {...this.states}; }

  setState(key, state) {
    this.states[key] = state;
    this.changed();
  }

  startAll() {
    if (this.stopping || this.restarting) return false;
    // Missing payloads must not leave a partially started stack.
    const missing = this.specs.filter(spec => !this.exists(path.join(this.bin, spec.file)));
    if (missing.length) {
      for (const spec of missing) {
        this.setState(spec.key, 'MISSING BINARY');
        this.log(spec.key, 'stderr', `Missing backend: ${path.join(this.bin, spec.file)}`);
      }
      return false;
    }
    for (const spec of this.specs) {
      if (this.children.has(spec.key)) continue;
      this.startProcess(spec);
    }
    return true;
  }

  startProcess(spec) {
      this.setState(spec.key, 'STARTING');
      try {
        const child = this.spawnProcess(path.join(this.bin, spec.file), spec.args || [], {
          cwd: this.root, windowsHide: true,
          env: {...process.env, MCS_DATA_ROOT: this.root, OSJS_DATA_DIR: this.root}, stdio: ['ignore', 'pipe', 'pipe']
        });
        this.children.set(spec.key, child);
        child.once('spawn', () => this.setState(spec.key, 'RUNNING'));
        child.once('error', error => {
          this.log(spec.key, 'stderr', error.message);
          if (!child.pid) this.children.delete(spec.key);
          this.setState(spec.key, 'ERROR');
        });
        child.once('exit', (code, signal) => {
          this.children.delete(spec.key);
          this.log(spec.key, 'stderr', `Exited: code=${code}, signal=${signal}`);
          this.setState(spec.key, this.stopping ? 'STOPPED' : 'EXITED');
        });
        for (const stream of ['stdout', 'stderr']) {
          child[stream]?.on('data', data => this.log(spec.key, stream, data.toString().slice(-8192)));
        }
        return child;
      } catch (error) {
        this.log(spec.key, 'stderr', error.message);
        this.setState(spec.key, 'ERROR');
      }
  }

  restart(key) {
    if (this.stopping || this.restarting) return Promise.reject(new Error('Runtime lifecycle operation already in progress'));
    const spec = this.specs.find(item => item.key === key);
    if (!spec || !this.children.has(key)) return Promise.reject(new Error(`Cannot restart unowned ${key} process`));
    this.restarting = Promise.resolve().then(async () => {
      await this.stopProcess(key);
      if (this.stopping) throw new Error('Application is stopping');
      const child = this.startProcess(spec);
      if (!child) throw new Error(`Failed to start ${key}`);
      await new Promise((resolve, reject) => {
        const cleanup = () => { child.removeListener('spawn', ready); child.removeListener('error', failed); };
        const ready = () => { cleanup(); resolve(); };
        const failed = error => { cleanup(); reject(error); };
        child.once('spawn', ready);
        child.once('error', failed);
      });
    }).finally(() => { this.restarting = null; });
    return this.restarting;
  }

  async stopProcess(key) {
    const child = this.children.get(key);
    if (!child) return;
    this.setState(key, 'STOPPING');
    await new Promise((resolve, reject) => {
      let timer;
      const done = () => { clearTimeout(timer); resolve(); };
      child.once('exit', done);
      timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (error) { this.log(key, 'stderr', error.message); }
        timer = setTimeout(() => {
          child.removeListener('exit', done);
          this.setState(key, 'STOP FAILED');
          reject(new Error(`Could not stop owned ${key} process.`));
        }, this.timeout);
      }, this.timeout);
      // Windows needs a cooperative backend protocol for graceful shutdown.
      try { child.kill('SIGTERM'); } catch (error) { this.log(key, 'stderr', error.message); }
    });
  }

  stopAll() {
    if (this.stopping) return this.stopping;
    // Defer until stopping is assigned, including when a mock exits synchronously.
    this.stopping = Promise.resolve().then(async () => {
      if (this.restarting) await this.restarting.catch(() => {});
      for (const spec of [...this.specs].reverse()) {
        await this.stopProcess(spec.key);
      }
      return true;
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }
}

module.exports = {PortableRuntime};
