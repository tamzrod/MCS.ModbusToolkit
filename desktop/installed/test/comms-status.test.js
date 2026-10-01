const test = require('node:test');
const assert = require('node:assert/strict');
const comms = require('../renderer/comms-status');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  setAttribute(key, value) { this.attributes[key] = value; }
  animate(frames, options) { this.animations = [...this.animations || [], {frames, options}]; }
  addEventListener(key, handler) { this.events[key] = handler; }
  querySelector(selector) {
    for (const child of this.children) { if (`#${child.id}` === selector) return child; const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
}
const document = {createElement: tag => new Element(tag)};

const statusFixture = () => ({name: 'PLC', enabled: true, running: true,
  comms: {network: 'UNKNOWN', tcp: 'OK', modbus: 'WARNING', mma2: 'ERROR'},
  network: {state: 'UNKNOWN', outcome: 'ICMP_UNAVAILABLE'},
  blocks: [{index: 0, function: 3, start: 10, count: 2,
    tcp: {state: 'OK', outcome: 'CONNECTED', endpoint: '127.0.0.1:502', observed_at: '2026-09-18T01:00:00Z'},
    modbus: {state: 'WARNING', outcome: 'EXCEPTION', exception_code: 2, error: 'Illegal address'},
    mma2: {state: 'ERROR', outcome: 'REJECTED', error: 'Raw write rejected'}}]});

test('real layer state and evidence update existing nodes in place', () => {
  const strip = comms.create(document);
  const button = strip.querySelector('#rep-comms-modbus');
  const detail = strip.querySelector('#rep-comms-modbus-detail');
  button.events.focus();
  comms.update(strip, statusFixture(), 'PLC');
  assert.equal(strip.querySelector('#rep-comms-modbus'), button);
  assert.equal(detail.hidden, false);
  assert.equal(button.dataset.state, 'WARNING');
  assert.match(detail.textContent, /Block 1 \/ FC3 \/ 10 \+ 2/);
  assert.match(detail.textContent, /Exception code: 2/);
  assert.match(detail.textContent, /Illegal address/);
  assert.equal(strip.querySelector('#rep-comms-mma2').dataset.state, 'ERROR');
  comms.update(strip, null, 'PLC', 'Pipe unavailable');
  assert.equal(button.dataset.state, 'UNKNOWN');
  assert.match(detail.textContent, /Pipe unavailable/);
});

test('process existence, wrong selection and disabled devices cannot imply health', () => {
  for (const status of [null, {running: true}, {...statusFixture(), name: 'other'}, {...statusFixture(), enabled: false}, {...statusFixture(), unavailable: true}, {...statusFixture(), comms: {tcp: 'CONFIGURED'}}]) {
    const model = comms.viewModel(status, 'PLC');
    assert.equal(model.tcp.state, 'UNKNOWN');
  }
});

test('older runtime status explains missing telemetry without inventing health', () => {
  const model = comms.viewModel({name: 'PLC', enabled: true, running: true, source_status: 'OK'}, 'PLC');
  assert.equal(model.tcp.state, 'UNKNOWN');
  assert.match(model.tcp.detail, /Update and restart the Replicator backend/);
});

test('activity pulses once per new observation and never for failed writes', () => {
  const strip = comms.create(document);
  const status = statusFixture();
  status.name = 'pulse-device';
  status.comms.mma2 = 'OK';
  status.blocks[0].tcp.activity_at = '2026-09-18T03:00:00.0000001Z';
  status.blocks[0].mma2 = {state: 'OK', outcome: 'ACKNOWLEDGED', last_success_at: '2026-09-18T03:00:00.0000001Z'};
  const tcp = strip.querySelector('#rep-comms-tcp');
  const mma2 = strip.querySelector('#rep-comms-mma2');
  comms.update(strip, status, status.name);
  comms.update(strip, status, status.name);
  assert.equal(tcp.animations.length, 1);
  assert.equal(mma2.animations.length, 1);
  assert.deepEqual(mma2.animations[0].options, {duration: 240, iterations: 1});
  const recreated = comms.create(document);
  comms.update(recreated, status, status.name);
  assert.equal(recreated.querySelector('#rep-comms-mma2').animations, undefined);
  status.blocks[0].tcp.activity_at = '2026-09-18T03:00:01Z';
  status.comms.mma2 = 'ERROR'; status.blocks[0].mma2.state = 'ERROR';
  comms.update(strip, status, status.name);
  assert.equal(tcp.animations.length, 2);
  assert.equal(mma2.animations.length, 1);
});

test('four labeled gray circles with keyboard, pointer and tap details', () => {
  const strip = comms.create(document);
  assert.equal(strip.children[0].children[0].textContent, 'SOURCE');
  assert.equal(strip.children[1].children[0].textContent, 'DESTINATION');
  const items = strip.children.flatMap(group => group.children[1].children);
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(item => item.children[0].textContent), ['Network', 'TCP', 'Modbus', 'MMA2']);
  for (const item of items) {
    const [, button, detail] = item.children;
    assert.equal(button.tagName, 'button');
    assert.equal(button.dataset.state, 'UNKNOWN');
    assert.equal(detail.hidden, true);
    button.events.focus(); assert.equal(detail.hidden, false);
    button.events.click(); assert.equal(detail.hidden, false);
    button.events.keydown({key: 'Escape'}); assert.equal(detail.hidden, true);
    button.events.click(); assert.equal(detail.hidden, false);
    button.events.blur(); assert.equal(detail.hidden, true);
    item.events.pointerenter(); assert.equal(detail.hidden, false);
    item.events.pointerleave(); assert.equal(detail.hidden, true);
  }
});
