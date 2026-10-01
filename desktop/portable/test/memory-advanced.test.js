const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../renderer/memory-advanced');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.events[key] = callback; }
  querySelector(selector) { return collect(this).find(node => node !== this && node.tagName === selector) || null; }
}
const collect = root => [root, ...root.children.flatMap(collect)];
const document = {createElement: tag => new Element(tag)};
const find = (root, label) => collect(root).find(node => node.attributes['aria-label'] === label);
const click = (root, title) => {
  const button = collect(root).find(node => node.tagName === 'button' && node.textContent === title);
  assert.ok(button, `missing button ${title}`); assert.equal(button.disabled, false); button.events.click();
};
const change = (node, value) => { node.value = value; node.events.change(); };
const type = (node, value) => { node.value = value; node.events.input(); };
const setup = (params = {...ui.defaults(), fc1: {start: 10, count: 16}}) => {
  const root = new Element('div');
  const devices = [{mma2: params}];
  const options = {document, devices, outputLoaded: true, outputListen: '127.0.0.1:19001'};
  ui.mount(root, params, options);
  return {root, params, options};
};

test('new defaults are independent and opening advanced tabs does not alter saved settings', () => {
  const first = ui.defaults(); const second = ui.defaults();
  assert.deepEqual(first.policy.rules[0].source_ip, ['0.0.0.0/0', '::/0']);
  assert.equal(first.state_sealing.enabled, false);
  first.policy.rules[0].source_ip.pop(); assert.equal(second.policy.rules[0].source_ip.length, 2);
  const params = {fc1: {start: 10, count: 16}};
  const before = JSON.stringify(params);
  const {root} = setup(params);
  click(root, 'State Sealing'); click(root, 'Access Policy'); click(root, 'RBE Rules');
  assert.equal(JSON.stringify(params), before);
});

test('Replicator advanced editor uses destination area unions and persists only advanced fields', () => {
  const device = {pull_blocks: [{function: 1, start: 10, count: 4}, {function: 1, start: 20, count: 2}, {function: 3, start: 100, count: 8}], mma2_advanced: ui.defaults()};
  const params = ui.replicatorParams(device);
  assert.deepEqual(params.fc1, {start: 10, count: 12});
  assert.deepEqual(params.fc3, {start: 100, count: 8});
  const {root} = setup(params);
  click(root, 'Add');
  assert.equal(device.mma2_advanced.rbe.coils[0].start, 10);
  click(root, 'State Sealing');
  const enabled = find(root, 'Enable state sealing'); enabled.checked = true; enabled.events.change();
  type(find(root, 'Control address'), '11');
  assert.equal(device.mma2_advanced.state_sealing.address, 11);
  assert.equal(device.mma2_advanced.fc1, undefined);
  assert.equal(ui.replicatorParams(device).rbe.coils[0].id, 1);
});

test('state sealing controls are disabled while off and emit the selected values without help text', () => {
  const {root, params} = setup(); click(root, 'State Sealing');
  assert.equal(find(root, 'Control address').disabled, true);
  const enabled = find(root, 'Enable state sealing'); enabled.checked = true; enabled.events.change();
  type(find(root, 'Control address'), '12'); change(find(root, 'Sealed response'), '2');
  assert.deepEqual(params.state_sealing, {enabled: true, area: 'coil', address: 12, exception: 2});
  assert.equal(find(root, 'Control area').disabled, true);
  assert.ok(!collect(root).some(node => /0 =|1 =|Modbus reads/.test(node.textContent || '')));
});

test('access checkboxes are Custom-only and preset/source selections use canonical values', () => {
  const {root, params} = setup(); click(root, 'Access Policy');
  assert.equal(find(root, 'Access').value, 'Read/Write');
  assert.equal(collect(root).filter(node => node.type === 'checkbox').length, 0);
  change(find(root, 'Access'), 'Read Only'); assert.deepEqual(params.policy.rules[0].allow_fc, [1, 2, 3, 4]);
  change(find(root, 'Access'), 'Write Only'); assert.deepEqual(params.policy.rules[0].allow_fc, [5, 6, 15, 16]);
  change(find(root, 'Access'), 'Custom');
  assert.equal(collect(root).filter(node => node.type === 'checkbox').length, 8);
  const coil = find(root, 'FC1 Read Coils'); coil.checked = true; coil.events.change();
  assert.ok(params.policy.rules[0].allow_fc.includes(1));
  const source = find(root, 'Source IP / CIDR');
  assert.equal(source.attributes.list, undefined);
  type(source, 'All IPv6'); assert.equal(params.policy.rules[0].source_ip[0], '::/0');
  change(find(root, 'Source presets'), 'Custom'); assert.equal(source.value, '');
  type(source, '192.168.4.0/24'); assert.equal(params.policy.rules[0].source_ip[0], '192.168.4.0/24');
  change(find(root, 'Source presets'), 'All IPv4');
  assert.equal(params.policy.rules[0].source_ip[0], '0.0.0.0/0');
  change(find(root, 'Access'), 'Read/Write');
  assert.equal(collect(root).filter(node => node.type === 'checkbox').length, 0);
});

test('comma-separated sources normalize without shifting later source rows while typing', () => {
  const {root, params} = setup(); click(root, 'Access Policy');
  const source = find(root, 'Source IP / CIDR');
  type(source, '192.168.1.5, 10.0.0.0/8, ,2001:db8::/32');
  assert.deepEqual(params.policy.rules[0].source_ip, ['192.168.1.5', '10.0.0.0/8', '2001:db8::/32', '::/0']);
  type(source, '192.168.1.6, 10.0.0.0/8');
  assert.deepEqual(params.policy.rules[0].source_ip, ['192.168.1.6', '10.0.0.0/8', '::/0']);
  change(find(root, 'Source presets'), 'All IPv6');
  assert.deepEqual(params.policy.rules[0].source_ip, ['::/0', '::/0']);
});

test('policy ordering, removal and draft edits persist across subtab changes', () => {
  const {root, params} = setup(); click(root, 'Access Policy'); click(root, 'Add');
  type(find(root, 'Rule ID'), 'second'); click(root, '↑');
  assert.equal(params.policy.rules[0].id, 'second');
  click(root, 'State Sealing'); click(root, 'Access Policy');
  assert.equal(find(root, 'Rule ID').value, 'second');
  click(root, 'Remove source'); assert.equal(params.policy.rules[0].source_ip.length, 1);
  click(root, 'Add source'); assert.equal(params.policy.rules[0].source_ip.length, 2);
  click(root, 'Delete'); assert.equal(params.policy.rules.length, 1);
});

test('RBE displays the configured port and edits independent rules with unused IDs', () => {
  const {root, params, options} = setup();
  assert.ok(collect(root).some(node => node.textContent === 'RBE TCP Port: 19001'));
  options.devices.push({mma2: {rbe: {coils: [{id: 1}]}}});
  click(root, 'Add'); assert.equal(params.rbe.coils[0].id, 2);
  type(find(root, 'Name'), 'temperature'); type(find(root, 'Start'), '11');
  click(root, 'State Sealing'); click(root, 'RBE Rules');
  assert.equal(find(root, 'Name').value, 'temperature');
  assert.equal(params.rbe.coils[0].start, 11);
  click(root, 'Delete'); assert.equal(params.rbe, null);
  options.outputListen = undefined; ui.mount(root, params, options);
  assert.ok(collect(root).some(node => node.textContent === 'RBE TCP Port: Not configured'));
});

test('shared output edits stay separate from per-device data', () => {
  const root = new Element('div'); const settings = {};
  ui.mountShared(root, settings, document);
  const enabled = find(root, 'Enable RBE TCP output'); enabled.checked = true; enabled.events.change();
  assert.equal(settings.rbe.tcp.listen, ':9001');
  type(find(root, 'RBE TCP listen address (IP:port)'), '[::1]:9900');
  assert.equal(settings.rbe.tcp.listen, '[::1]:9900');
  const disabled = find(root, 'Enable RBE TCP output'); disabled.checked = false; disabled.events.change();
  assert.equal(settings.rbe, null);
});

test('device copies get unused global RBE IDs and exhaustion leaves the copy unchanged', () => {
  const original = {rbe: {coils: [{id: 1}, {id: 3}]}};
  const copied = JSON.parse(JSON.stringify(original));
  ui.assignCopiedIDs(copied, [{mma2: original}]);
  assert.deepEqual(copied.rbe.coils.map(rule => rule.id), [2, 4]);
  assert.deepEqual(original.rbe.coils.map(rule => rule.id), [1, 3]);
  const full = {rbe: {coils: Array.from({length: 255}, (_, index) => ({id: index + 1}))}};
  assert.throws(() => ui.assignCopiedIDs(copied, [{mma2: full}]), /unused RBE/);
  assert.deepEqual(copied.rbe.coils.map(rule => rule.id), [2, 4]);
});
