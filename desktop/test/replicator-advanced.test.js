const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.events = {}; this.classList = {toggle() {}, add() {}}; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren() { this.children = []; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(key, callback) { this.events[key] = callback; }
  querySelector(selector) { return collect(this).find(node => node !== this && (node.tagName === selector || '#' + node.id === selector)) || null; }
}
const collect = root => [root, ...root.children.flatMap(collect)];

test('rename drafts do not poll unknown names; save, reload, rejection and discard retain identity', async () => {
  const root = new Element('div');
  const queried = [];
  let stored;
  let rejectSave = false;
  const document = {querySelectorAll: () => [], createElement: tag => new Element(tag),
    querySelector: () => null, getElementById: id => id === 'replicator-root' ? root : root.querySelector('#' + id)};
  const context = vm.createContext({document, window: {
    mcsMemoryUI: require('../renderer/memory-advanced'),
    mcsComms: {create: () => new Element('div'), update: () => {}},
    mcsDesktop: {replicatorCall: async (operation, payload) => {
      if (operation === 'status') { queried.push(payload.name); return {name: payload.name}; }
      if (operation === 'load') return {document: stored};
      if (rejectSave) throw new Error('duplicate name');
      stored = JSON.parse(JSON.stringify(payload.document)); return {document: stored};
    }}
  }});
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf("document.addEventListener('click'")), context);
  const run = code => vm.runInContext(code, context);
  run('replaceReplicatorDraft({devices:[blankReplicator(1)]}); replicatorState.persisted = clone(replicatorState.document); replicatorState.selected = 0; renderReplicator();');
  await run('pollReplicator()');
  assert.deepEqual(queried, ['Rep-PLC-1']);
  const nameInput = collect(root).find(node => node.tagName === 'label' && node.children[0]?.textContent === 'Name').querySelector('input');
  nameInput.events.input({target: {value: 'renamed'}});
  await run('pollReplicator()');
  assert.equal(queried.length, 1);
  assert.ok(collect(root).includes(nameInput));
  assert.ok(root.querySelector('#rep-status-message').textContent.includes('Unsaved'));
  await run('saveReplicator()');
  assert.equal(stored.devices[0].name, 'renamed');
  assert.equal(queried.at(-1), 'renamed');
  await run('loadReplicator()');
  assert.equal(run('selectedReplicator().name'), 'renamed');
  rejectSave = true;
  run('selectedReplicator().name = "duplicate"');
  await run('saveReplicator()');
  assert.equal(run('selectedReplicator().name'), 'duplicate');
  assert.ok(root.querySelector('#rep-status-message').textContent.includes('duplicate name'));
  assert.equal(queried.includes('duplicate'), false);
  run('replaceReplicatorDraft(replicatorState.persisted); renderReplicator();');
  await run('pollReplicator()');
  assert.equal(queried.at(-1), 'renamed');
});

test('Replicator RBE output settings save a user-selected port and refresh both editors', async () => {
  const roots = {'simulator-root': new Element('div'), 'replicator-root': new Element('div')};
  let submitted;
  const document = {querySelectorAll: () => [], createElement: tag => new Element(tag),
    getElementById: id => roots[id] || Object.values(roots).map(root => root.querySelector('#' + id)).find(Boolean)};
  const context = vm.createContext({document, window: {
    mcsMemoryUI: require('../renderer/memory-advanced'),
    mcsComms: {create: () => new Element('div'), update: () => {}},
    mcsDesktop: {simulatorCall: async (operation, payload) => {
      assert.equal(operation, 'mma-apply'); submitted = payload; return payload;
    }}
  }});
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf("document.addEventListener('click'")), context);
  const run = code => vm.runInContext(code, context);
  run('mmaState.loaded = true; simulatorState.document.devices = [simulatorBlankDevice(1)]; simulatorState.selected = 0; memoryView.editor = "advanced"; replicatorState.document.devices = [blankReplicator(1)]; replicatorState.selected = 0; replicatorView.editor = "advanced"; renderMMAViews();');
  const root = roots['replicator-root'];
  collect(root).find(node => node.textContent === 'RBE TCP Settings...').events.click();
  assert.ok(root.querySelector('dialog'));
  assert.equal(roots['simulator-root'].querySelector('dialog'), null);
  const toggle = collect(root).find(node => node['aria-label'] === 'Enable RBE TCP output');
  toggle.checked = true; toggle.events.change();
  const address = collect(root).find(node => node['aria-label'] === 'RBE TCP listen address (IP:port)');
  assert.equal(address.value, ':9001');
  address.value = '127.0.0.1:19432'; address.events.input();
  await run('saveMMASettings()');
  assert.equal(submitted.settings.rbe.tcp.listen, '127.0.0.1:19432');
  for (const panel of Object.values(roots)) assert.ok(collect(panel).some(node => node.textContent === 'RBE TCP Port: 19432'));
  root.querySelector('dialog').events.cancel({preventDefault() {}});
  assert.equal(root.querySelector('dialog'), null);
});

test('Replicator folder tabs retain advanced drafts through save rejection and discard', async () => {
  const root = new Element('div');
  let submitted;
  const document = {querySelectorAll: () => [], createElement: tag => new Element(tag),
    querySelector: selector => selector === '[data-action=rep-save]' ? collect(root).find(node => node.dataset.action === 'rep-save') : root.querySelector(selector),
    getElementById: id => id === 'replicator-root' ? root : root.querySelector('#' + id)};
  const context = vm.createContext({document, window: {
    mcsMemoryUI: require('../renderer/memory-advanced'),
    mcsComms: {create: () => new Element('div'), update: () => {}},
    mcsDesktop: {replicatorCall: (operation, payload) => {
      if (operation === 'status') return new Promise(() => {});
      submitted = payload;
      return Promise.reject(new Error('test rejection'));
    }}
  }});
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf("document.addEventListener('click'")), context);
  const run = code => vm.runInContext(code, context);
  const click = title => {
    const button = collect(root).find(node => node.tagName === 'button' && node.textContent === title);
    assert.ok(button, title); button.events.click();
  };
  run('replicatorState.document.devices = [blankReplicator(1)]; replicatorState.persisted = clone(replicatorState.document); replicatorState.selected = 0; renderReplicator();');
  const port = collect(root).find(node => node.tagName === 'label' && node.children[0]?.textContent === 'Port').querySelector('input');
  const autoPort = collect(root).find(node => node.tagName === 'label' && node.children[1]?.textContent === 'Auto Port').querySelector('input');
  assert.equal(port.readOnly, true);
  autoPort.events.change({target: {checked: false}});
  assert.equal(port.readOnly, false);
  port.events.input({target: {value: '15021'}});
  assert.equal(run('selectedReplicator().destination.port'), 15021);
  autoPort.events.change({target: {checked: true}});
  assert.equal(port.readOnly, true);
  assert.equal(port, collect(root).find(node => node.tagName === 'label' && node.children[0]?.textContent === 'Port').querySelector('input'));
  click('Advanced Settings');
  assert.ok(collect(root).some(node => node.textContent === 'RBE Rules'));
  click('Access Policy');
  const control = collect(root).find(node => node['aria-label'] === 'Source IP / CIDR');
  control.value = '10.0.0.1, 192.168.0.0/16'; control.events.input();
  click('Device Definition'); click('Advanced Settings');
  assert.equal(run('selectedReplicator().mma2_advanced.policy.rules[0].source_ip[1]'), '192.168.0.0/16');
  await run('saveReplicator()');
  assert.equal(submitted.document.devices[0].mma2_advanced.policy.rules[0].source_ip[0], '10.0.0.1');
  assert.equal(run('selectedReplicator().mma2_advanced.policy.rules[0].source_ip[0]'), '10.0.0.1');
  run('replicatorState.document = clone(replicatorState.persisted); renderReplicator();');
  assert.equal(run('selectedReplicator().mma2_advanced.policy.rules[0].source_ip[0]'), '0.0.0.0/0');
});
