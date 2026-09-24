const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren() { this.children = []; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(key, handler) { this.events[key] = handler; }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.tagName === selector || `#${child.id}` === selector) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

const setup = () => {
  const root = new Element('root');
  const document = {
    querySelectorAll: () => [],
    createElement: tag => new Element(tag),
    getElementById: id => id === 'simulator-root' ? root : root.querySelector(`#${id}`)
  };
  const pending = [];
  const context = vm.createContext({document, window: {mcsMemoryUI: require('../renderer/memory-advanced'), mcsDesktop: {
    simulatorCall: () => new Promise((resolve, reject) => pending.push({resolve, reject}))
  }}});
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('const blankBlock =')), context);
  vm.runInContext('simulatorState.document.devices = [simulatorBlankDevice(1), simulatorBlankDevice(2)]; simulatorState.selected = 0; renderSimulator();', context);
  return {root, pending, run: code => vm.runInContext(code, context)};
};

test('zero interval synchronizes Random to None and remembers the prior interval', () => {
  const {root, run} = setup();
  const mode = root.querySelector('select');
  mode.value = 'random';
  mode.events.change();
  const findInterval = node => node.tagName === 'input' && node.min === 1 && node.step === 1
    ? node : node.children.map(findInterval).find(Boolean);
  const interval = findInterval(root);
  interval.events.input({target: {value: '250'}});
  interval.events.input({target: {value: '0'}});
  assert.equal(mode.value, 'none');
  assert.equal(interval.disabled, true);
  assert.equal(run('selectedSimulator().random_runtime.fc1_interval_ms'), 0);
  mode.value = 'random';
  mode.events.change();
  assert.equal(interval.value, '250');
  assert.equal(interval.disabled, false);
});

test('selection changes clear status and discard old success and failure responses', async () => {
  const {root, pending, run} = setup();
  const old = run('pollSimulator()');
  run('simulatorState.selected = 1; renderSimulator();');
  assert.equal(root.querySelector('#sim-runtime-mma2').textContent, '-');
  const current = run('pollSimulator()');
  pending[1].resolve({status: {mma2_status: 'RUNNING', device_status: 'IDLE'}});
  await current;
  pending[0].resolve({status: {mma2_status: 'STOPPED'}});
  await old;
  assert.equal(root.querySelector('#sim-runtime-mma2').textContent, 'RUNNING');
  const stale = run('pollSimulator()');
  const fresh = run('pollSimulator()');
  pending[3].resolve({status: {mma2_status: 'RUNNING'}});
  await fresh;
  pending[2].reject(new Error('old failure'));
  await stale;
  assert.equal(root.querySelector('#sim-runtime-mma2').textContent, 'RUNNING');
});

test('current polling failure clears healthy status without rerendering the editor', async () => {
  const {root, pending, run} = setup();
  const success = run('pollSimulator()');
  pending[0].resolve({status: {mma2_status: 'RUNNING', device_status: 'IDLE'}});
  await success;
  const input = root.querySelector('input');
  const failure = run('pollSimulator()');
  pending[1].reject(new Error('unavailable'));
  await failure;
  assert.equal(root.querySelector('#sim-runtime-mma2').textContent, 'UNAVAILABLE');
  assert.equal(root.querySelector('#sim-runtime-device').textContent, 'UNAVAILABLE');
  assert.equal(root.querySelector('input'), input);
  assert.equal(run('simulatorState.runtimeStatus'), null);
});

test('device drafts survive tab changes, save failure, and discard restores the saved snapshot', async () => {
  const {pending, run} = setup();
  run('simulatorState.persisted = clone(simulatorState.document); selectedSimulator().mma2.state_sealing = {enabled:true,area:"coil",address:0,exception:6}; memoryView.editor = "advanced"; renderSimulator(); memoryView.editor = "definition"; renderSimulator();');
  assert.equal(run('selectedSimulator().mma2.state_sealing.enabled'), true);
  const save = run('saveSimulator()'); pending[0].reject(new Error('validation failed')); await save;
  assert.equal(run('selectedSimulator().mma2.state_sealing.enabled'), true);
  run('discardSimulator(); renderSimulator();');
  assert.equal(run('selectedSimulator().mma2.state_sealing.enabled'), false);
});

test('shared settings open only from Advanced Settings and close without losing drafts', () => {
  const {root, run} = setup();
  assert.equal(root.querySelector('#mma-settings-open'), null);
  assert.equal(root.querySelector('dialog'), null);
  run('memoryView.editor = "advanced"; mmaState.loaded = true; renderSimulator();');
  root.querySelector('#mma-settings-open').events.click();
  const dialog = root.querySelector('dialog');
  assert.ok(dialog);
  assert.ok(root.querySelector('#sim-runtime-mma2'));
  run('mmaState.document.debug = {enabled:true};');
  let prevented = false;
  dialog.events.cancel({preventDefault: () => { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(root.querySelector('dialog'), null);
  root.querySelector('#mma-settings-open').events.click();
  assert.equal(run('mmaState.document.debug.enabled'), true);
});

test('shared Save uses MMA IPC and preserves drafts on rejection', async () => {
  const {pending, run} = setup();
  run('mmaState.loaded = true; mmaState.document = {rbe:{tcp:{listen:"127.0.0.1:9900"}}}; memoryView.section = "mma";');
  const save = run('saveMMASettings()'); pending[0].reject(new Error('port collision')); await save;
  assert.equal(run('mmaState.document.rbe.tcp.listen'), '127.0.0.1:9900');
  assert.equal(run('mmaState.error'), true);
  const retry = run('saveMMASettings()'); pending[1].resolve({settings:{rbe:{tcp:{listen:'127.0.0.1:9900'}}}}); await retry;
  assert.equal(run('mmaState.persisted.rbe.tcp.listen'), '127.0.0.1:9900');
});
