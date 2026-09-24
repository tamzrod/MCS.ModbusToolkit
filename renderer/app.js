const tabs = [...document.querySelectorAll('.tab')];
const panels = [...document.querySelectorAll('.panel')];
const log = document.getElementById('log');
let runtimePaths = null;
let replicatorPollVersion = 0;
let replicatorStatusReceivedAt = 0;
let simulatorPollVersion = 0;

const clone = value => JSON.parse(JSON.stringify(value));
const numberValue = value => value === '' ? 0 : Number(value);
const FC_KEYS = ['fc1', 'fc2', 'fc3', 'fc4'];
const FC_LABELS = {fc1: 'Coils (FC1)', fc2: 'Discrete Inputs (FC2)', fc3: 'Holding Registers (FC3)', fc4: 'Input Registers (FC4)'};
const rememberedIntervals = new WeakMap();

const h = (tag, className = '', text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const actionButton = (label, action, className = '') => {
  const node = h('button', `tool-button ${className}`.trim(), label);
  node.type = 'button';
  node.dataset.action = action;
  return node;
};
const field = (label, value, settings, onInput) => {
  const wrapper = h('label', settings.className || 'tool-field');
  wrapper.appendChild(h('span', 'tool-field-label', label));
  const input = document.createElement(settings.multiline ? 'textarea' : 'input');
  if (!settings.multiline) input.type = settings.type || 'number';
  input.value = value ?? '';
  input.readOnly = Boolean(settings.readOnly);
  ['min', 'max', 'step', 'placeholder'].forEach(key => {
    if (settings[key] !== undefined) input[key] = settings[key];
  });
  input.addEventListener('input', event => onInput(event.target.value));
  wrapper.appendChild(input);
  return wrapper;
};
const isEditableControl = target => Boolean(target.closest('input, select, textarea, option, label'));
const checkboxField = (label, checked, onChange) => {
  const wrapper = h('label', 'tool-checkbox');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.addEventListener('change', event => onChange(event.target.checked));
  wrapper.append(input, h('span', '', label));
  return wrapper;
};

// Service status patches text/classes in place. The activity stream is not used
// for header animation, so it cannot disturb editable controls.
const setStatuses = value => {
  ['mma2', 'replicator'].forEach(key => {
    const node = document.getElementById(`status-${key}`);
    if (!node) return;
    const status = value && value[key] || 'STOPPED';
    node.textContent = status;
    node.className = status === 'RUNNING' ? 'status-ok' : 'status-stop';
  });
  const simulator = document.getElementById('diag-status-simulator');
  if (simulator) {
    const status = value && value.simulator || 'STOPPED';
    simulator.textContent = status;
    simulator.className = status === 'RUNNING' ? 'status-ok' : 'status-stop';
  }
};
const appendLog = entry => {
  const line = `[${new Date().toLocaleTimeString()}] ${entry.process}/${entry.level}: ${entry.text}`;
  log.textContent += line.endsWith('\n') ? line : `${line}\n`;
  log.scrollTop = log.scrollHeight;
};
const formatTime = value => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};
const setText = (id, value) => {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
};
const addressRange = area => {
  const start = Number(area && area.start) || 0;
  const count = Number(area && area.count) || 0;
  if (!count) return 'Unused';
  const end = start + count - 1;
  return start === end ? String(start) : `${start}-${end}`;
};

const simulatorBlankDevice = sequence => ({
  name: `Sim-PLC-${sequence}`,
  enabled: true,
  mma2: {
    ...window.mcsMemoryUI.defaults(),
    port: 5020,
    unit_id: 1,
    fc1: {start: 0, count: 16},
    fc2: {start: 0, count: 16},
    fc3: {start: 0, count: 16},
    fc4: {start: 0, count: 16}
  },
  // Zero means None. Existing saved positive intervals continue to mean Random.
  random_runtime: {
    fc1_interval_ms: 0,
    fc2_interval_ms: 0,
    fc3_interval_ms: 0,
    fc4_interval_ms: 0
  }
});
const validateSimulator = device => {
  if (!device.name || !device.name.trim()) return 'Name is required.';
  if (!device.mma2.port || device.mma2.port < 1 || device.mma2.port > 65535) return 'Listen Port must be between 1 and 65535.';
  if (device.mma2.unit_id < 0 || device.mma2.unit_id > 255) return 'Unit ID must be between 0 and 255.';
  for (const fc of FC_KEYS) {
    const area = device.mma2[fc];
    if (area.start < 0 || area.start > 65535 || area.count < 0 || area.count > 65535) return `${FC_LABELS[fc]} values are outside the 16-bit address range.`;
    if (area.start + area.count > 65536) return `${FC_LABELS[fc]} Start + Count exceeds the 16-bit address space.`;
    const interval = device.random_runtime[`${fc}_interval_ms`];
    if (!Number.isSafeInteger(interval) || interval < 0 || interval > 4294967295) return `${FC_LABELS[fc]} Interval must be a nonnegative integer in milliseconds.`;
  }
  return null;
};
const normalizeSimulatorDocument = value => ({devices: Array.isArray(value && value.devices) ? value.devices : []});
const simulatorState = {document: {devices: []}, persisted: {devices: []}, selected: null, loading: true, saving: false, message: 'Loading Memory definitions...', error: false, runtimeStatus: null};
const selectedSimulator = () => simulatorState.selected === null ? null : simulatorState.document.devices[simulatorState.selected];
const discardSimulator = () => {
  simulatorState.document = clone(simulatorState.persisted);
  simulatorState.selected = simulatorState.document.devices.length ? Math.min(simulatorState.selected || 0, simulatorState.document.devices.length - 1) : null;
  simulatorState.message = 'Changes discarded.'; simulatorState.error = false;
};
const memoryView = {section: 'devices', editor: 'definition'};
const mmaState = {document: {}, persisted: {}, loaded: false, loading: false, saving: false, message: '', error: false};
const advancedDevices = () => [...simulatorState.document.devices, ...(typeof replicatorState === 'undefined' ? [] : replicatorState.document.devices.map(device => ({mma2: device.mma2_advanced || {}})))];

const memoryTab = (label, active, callback) => {
  const button = h('button', 'tool-button', label);
  button.type = 'button'; button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.addEventListener('click', callback);
  return button;
};

const renderMMAViews = () => {
  renderSimulator();
  if (typeof renderReplicator === 'function') renderReplicator();
};
const openRBEOutput = section => {
  memoryView.section = section;
  renderMMAViews();
  if (!mmaState.loaded && !mmaState.loading) loadMMASettings();
};
const renderMMADialog = (root, section) => {
  let sharedDialog;
  if (memoryView.section === section) {
    sharedDialog = h('dialog', 'mma-dialog');
    sharedDialog.setAttribute('aria-label', 'MMA Settings');
    const close = () => {
      if (mmaState.saving) return;
      memoryView.section = 'devices'; renderMMAViews();
      document.getElementById('mma-settings-open')?.focus?.();
    };
    sharedDialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    const editor = h('section', 'tool-editor mma-editor');
    const fields = h('fieldset', 'memory-fields');
    fields.disabled = mmaState.saving || !mmaState.loaded;
    window.mcsMemoryUI.mountShared(fields, mmaState.document, document);
    const actions = h('div', 'editor-actions');
    const save = actionButton(mmaState.saving ? 'Saving...' : 'Save & Apply', 'mma-save', 'tool-primary');
    save.disabled = mmaState.saving || !mmaState.loaded;
    const discard = actionButton('Discard', 'mma-discard'); discard.disabled = mmaState.saving || !mmaState.loaded;
    actions.append(save, discard);
    const closeButton = h('button', 'tool-button', 'Close');
    closeButton.type = 'button'; closeButton.disabled = mmaState.saving;
    closeButton.addEventListener('click', close);
    actions.appendChild(closeButton);
    if (!mmaState.loaded && !mmaState.loading) actions.append(actionButton('Retry load', 'mma-load'));
    editor.append(fields, actions, h('div', `tool-status${mmaState.error ? ' error' : ''}`, mmaState.loading ? 'Loading MMA settings...' : mmaState.message));
    sharedDialog.appendChild(editor);
  }
  if (sharedDialog) {
    root.appendChild(sharedDialog);
    sharedDialog.showModal?.();
  }
};
const renderSimulator = () => {
  simulatorPollVersion++;
  simulatorState.runtimeStatus = null;
  const root = document.getElementById('simulator-root');
  root.replaceChildren();
  const shell = h('fieldset', 'tool-layout memory-fields');
  shell.disabled = simulatorState.saving;
  const sidebar = h('aside', 'tool-sidebar');
  sidebar.appendChild(h('h2', '', 'Devices'));
  const listActions = h('div', 'tool-actions');
  listActions.append(actionButton('Add', 'sim-add'), actionButton('Duplicate', 'sim-duplicate'), actionButton('Delete', 'sim-delete', 'tool-danger'));
  sidebar.appendChild(listActions);
  const list = h('div', 'tool-list');
  simulatorState.document.devices.forEach((device, index) => {
    const row = actionButton('', 'sim-select', index === simulatorState.selected ? 'tool-row selected' : 'tool-row');
    row.dataset.index = String(index);
    row.append(h('strong', '', device.name || 'Unnamed device'), h('span', '', `Port ${device.mma2.port} / Unit ${device.mma2.unit_id}${device.enabled ? '' : ' / Disabled'}`));
    list.appendChild(row);
  });
  if (!list.children.length) list.appendChild(h('div', 'tool-empty', simulatorState.loading ? 'Loading...' : 'No devices configured.'));
  sidebar.appendChild(list);
  shell.appendChild(sidebar);

  const editor = h('section', 'tool-editor');
  const editorTabs = h('nav', 'memory-subtabs');
  editorTabs.append(memoryTab('Device Definition', memoryView.editor === 'definition', () => { memoryView.editor = 'definition'; renderSimulator(); pollSimulator(); }),
    memoryTab('Advanced Settings', memoryView.editor === 'advanced', () => { memoryView.editor = 'advanced'; renderSimulator(); pollSimulator(); }));
  editor.appendChild(editorTabs);
  if (memoryView.editor === 'advanced') {
    const sharedActions = h('div', 'editor-actions');
    const open = h('button', 'tool-button', 'MMA Settings...');
    open.id = 'mma-settings-open'; open.type = 'button';
    open.addEventListener('click', () => {
      memoryView.section = 'mma'; renderSimulator();
      if (!mmaState.loaded && !mmaState.loading) loadMMASettings();
    });
    sharedActions.appendChild(open); editor.appendChild(sharedActions);
  }
  const device = selectedSimulator();
  if (!device) {
    editor.appendChild(h('div', 'tool-empty', 'Select a device or choose Add.'));
  } else {
    const runtime = h('div', 'runtime-row');
    const status = simulatorState.runtimeStatus;
    const mma2Status = h('strong', '', status && status.mma2_status || '-');
    mma2Status.id = 'sim-runtime-mma2';
    const deviceStatus = h('strong', '', status && status.device_status || '-');
    deviceStatus.id = 'sim-runtime-device';
    runtime.append(h('span', '', 'MMA2:'), mma2Status, h('span', '', 'Simulation:'), deviceStatus);
    editor.appendChild(runtime);
    if (memoryView.editor === 'definition') {
    const identity = h('div', 'tool-grid');
    identity.append(field('Name', device.name, {type: 'text'}, value => { device.name = value; }));
    identity.append(checkboxField('Enabled', device.enabled, value => { device.enabled = value; }));
    identity.append(field('Listen Port', device.mma2.port, {min: 1, max: 65535}, value => { device.mma2.port = numberValue(value); }));
    identity.append(field('Unit ID', device.mma2.unit_id, {min: 0, max: 255}, value => { device.mma2.unit_id = numberValue(value); }));
    editor.appendChild(identity);

    const table = h('div', 'fc-table memory-fc-table');
    const header = h('div', 'fc-row fc-header');
    ['Area', 'Start', 'Count', 'Simulation', 'Interval (ms)', 'Address Range'].forEach(label => header.appendChild(h('span', '', label)));
    table.appendChild(header);
    FC_KEYS.forEach(fc => {
      const row = h('div', 'fc-row');
      const area = device.mma2[fc];
      const intervalKey = `${fc}_interval_ms`;
      const interval = device.random_runtime[intervalKey];
      const range = h('span', 'range-cell', addressRange(area));
      row.appendChild(h('strong', '', FC_LABELS[fc]));
      row.appendChild(field('Start', area.start, {min: 0, max: 65535, className: 'cell-field'}, value => { area.start = numberValue(value); range.textContent = addressRange(area); }));
      row.appendChild(field('Count', area.count, {min: 0, max: 65535, className: 'cell-field'}, value => { area.count = numberValue(value); range.textContent = addressRange(area); }));

      const intervalField = field('Interval', interval, {min: 1, step: 1, className: 'cell-field'}, value => {
        device.random_runtime[intervalKey] = numberValue(value);
        if (device.random_runtime[intervalKey] === 0) {
          mode.value = 'none';
          intervalInput.value = '0';
          intervalInput.disabled = true;
        }
        if (Number(value) > 0) {
          const last = rememberedIntervals.get(device.random_runtime) || {};
          last[fc] = Number(value);
          rememberedIntervals.set(device.random_runtime, last);
        }
      });
      const intervalInput = intervalField.querySelector('input');
      intervalInput.disabled = interval === 0;
      const mode = document.createElement('select');
      mode.setAttribute('aria-label', `${FC_LABELS[fc]} simulation`);
      [['none', 'None'], ['random', 'Random']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        mode.appendChild(option);
      });
      mode.value = interval > 0 ? 'random' : 'none';
      mode.addEventListener('change', () => {
        if (mode.value === 'none') {
          if (device.random_runtime[intervalKey] > 0) {
            const last = rememberedIntervals.get(device.random_runtime) || {};
            last[fc] = device.random_runtime[intervalKey];
            rememberedIntervals.set(device.random_runtime, last);
          }
          device.random_runtime[intervalKey] = 0;
          intervalInput.value = '0';
          intervalInput.disabled = true;
        } else {
          const last = rememberedIntervals.get(device.random_runtime) || {};
          const nextInterval = last[fc] > 0 ? last[fc] : 1000;
          device.random_runtime[intervalKey] = nextInterval;
          intervalInput.value = String(nextInterval);
          intervalInput.disabled = false;
        }
      });
      const modeCell = h('span', 'sim-mode-cell');
      modeCell.appendChild(mode);
      row.append(modeCell, intervalField, range);
      table.appendChild(row);
    });
    editor.appendChild(table);
    } else {
      const advanced = h('div', 'memory-advanced');
      window.mcsMemoryUI.mount(advanced, device.mma2, {document, devices: advancedDevices(),
        outputLoaded: mmaState.loaded, outputListen: mmaState.persisted.rbe?.tcp?.listen,
        configureOutput: () => openRBEOutput('mma')});
      editor.appendChild(advanced);
    }
    const validation = validateSimulator(device);
    if (validation) editor.appendChild(h('div', 'tool-validation', validation));
    const actions = h('div', 'editor-actions');
    const save = actionButton(simulatorState.saving ? 'Saving...' : 'Save & Apply', 'sim-save', 'tool-primary');
    save.disabled = Boolean(validation) || simulatorState.saving;
    actions.append(save, actionButton('Discard', 'sim-discard'));
    editor.appendChild(actions);
  }
  editor.appendChild(h('div', `tool-status${simulatorState.error ? ' error' : ''}`, simulatorState.message));
  shell.appendChild(editor);
  root.appendChild(shell);
  renderMMADialog(root, 'mma');
};

const loadSimulator = async () => {
  simulatorState.loading = true;
  simulatorState.message = 'Loading Memory definitions...';
  simulatorState.error = false;
  renderSimulator();
  try {
    const result = await window.mcsDesktop.simulatorCall('load', {});
    const documentValue = normalizeSimulatorDocument(result.document);
    simulatorState.document = clone(documentValue);
    simulatorState.persisted = clone(documentValue);
    simulatorState.selected = documentValue.devices.length ? 0 : null;
    simulatorState.message = documentValue.devices.length ? 'Canonical Memory definitions loaded.' : 'No devices configured. Choose Add to begin.';
    simulatorState.error = false;
  } catch (error) {
    simulatorState.message = error.message || String(error);
    simulatorState.error = true;
  } finally {
    simulatorState.loading = false;
    renderSimulator();
  }
};
const pollSimulator = async () => {
  const device = selectedSimulator();
  if (!device || simulatorState.saving) return;
  const name = device.name;
  const version = ++simulatorPollVersion;
  const isCurrent = () => version === simulatorPollVersion && selectedSimulator() === device && device.name === name && !simulatorState.saving;
  try {
    const result = await window.mcsDesktop.simulatorCall('status', {name});
    if (!isCurrent()) return;
    simulatorState.runtimeStatus = result.status || result;
    setText('sim-runtime-mma2', simulatorState.runtimeStatus.mma2_status || '-');
    setText('sim-runtime-device', simulatorState.runtimeStatus.device_status || '-');
  } catch (_) {
    if (!isCurrent()) return;
    simulatorState.runtimeStatus = null;
    setText('sim-runtime-mma2', 'UNAVAILABLE');
    setText('sim-runtime-device', 'UNAVAILABLE');
  }
};
const loadMMASettings = async () => {
  if (mmaState.loading || mmaState.saving) return;
  mmaState.loading = true; mmaState.error = false;
  renderMMAViews();
  try {
    const result = await window.mcsDesktop.simulatorCall('mma-load', {});
    mmaState.document = clone(result.settings || {}); mmaState.persisted = clone(mmaState.document);
    mmaState.loaded = true; mmaState.message = 'MMA settings loaded.';
  } catch (error) { mmaState.error = true; mmaState.message = error.message || String(error); }
  finally { mmaState.loading = false; renderMMAViews(); }
};
const saveMMASettings = async () => {
  if (!mmaState.loaded || mmaState.saving) return;
  mmaState.saving = true; mmaState.error = false; renderMMAViews();
  try {
    const result = await window.mcsDesktop.simulatorCall('mma-apply', {settings: clone(mmaState.document)});
    mmaState.document = clone(result.settings || {}); mmaState.persisted = clone(mmaState.document);
    mmaState.message = result.message || 'MMA settings saved.';
  } catch (error) { mmaState.error = true; mmaState.message = error.message || String(error); }
  finally { mmaState.saving = false; renderMMAViews(); }
};
const saveSimulator = async () => {
  const validation = simulatorState.document.devices.map(validateSimulator).find(Boolean);
  if (validation) {
    simulatorState.message = validation;
    simulatorState.error = true;
    renderSimulator();
    return;
  }
  simulatorState.saving = true;
  simulatorState.message = 'Saving Memory definitions and applying runtime changes...';
  simulatorState.error = false;
  renderSimulator();
  try {
    const result = await window.mcsDesktop.simulatorCall('apply', {document: clone(simulatorState.document)});
    const documentValue = normalizeSimulatorDocument(result.document);
    simulatorState.document = clone(documentValue);
    simulatorState.persisted = clone(documentValue);
    simulatorState.message = `${result.message || 'Memory settings applied.'} ${result.completed_at ? `Completed at ${formatTime(result.completed_at)}.` : ''}`;
    simulatorState.error = false;
  } catch (error) {
    simulatorState.message = `Save & Apply failed: ${error.message || error}`;
    simulatorState.error = true;
  } finally {
    simulatorState.saving = false;
    renderSimulator();
    pollSimulator();
  }
};

const blankBlock = () => ({function: 3, start: 0, count: 16, scan_rate_ms: 1000});
const blankReplicator = sequence => ({
  mma2_advanced: window.mcsMemoryUI.defaults(),
  name: `Rep-PLC-${sequence}`,
  enabled: true,
  endpoint: '127.0.0.1:5020',
  unit_id: 1,
  pull_blocks: [blankBlock()],
  destination: {port: 5021, unit_id: 1, auto_port: true, auto_unit_id: true, owner: 'replicator', status: 'AVAILABLE'}
});
const normalizeRepDevice = value => {
  const device = clone(value || {});
  if (!Array.isArray(device.pull_blocks) || !device.pull_blocks.length) device.pull_blocks = [blankBlock()];
  if (!device.destination) device.destination = {port: 5021, unit_id: 1, auto_port: true, auto_unit_id: true, owner: 'replicator', status: 'AVAILABLE'};
  return device;
};
const normalizeRepDocument = value => ({devices: Array.isArray(value && value.devices) ? value.devices.map(normalizeRepDevice) : []});
const validateReplicator = device => {
  if (!device.name || !device.name.trim()) return 'Name is required.';
  if (!device.endpoint || !device.endpoint.includes(':')) return 'Endpoint must be host:port.';
  if (device.unit_id < 0 || device.unit_id > 255) return 'Source Unit ID must be between 0 and 255.';
  for (let i = 0; i < device.pull_blocks.length; i += 1) {
    const block = device.pull_blocks[i];
    const label = `Pull Block ${i + 1}`;
    if (![1, 2, 3, 4].includes(Number(block.function))) return `${label} Function must be FC1, FC2, FC3, or FC4.`;
    if (block.start < 0 || block.start > 65535) return `${label} Start must be between 0 and 65535.`;
    if (block.count < 1 || block.start + block.count > 65536) return `${label} Count must be positive and remain inside the 16-bit address space.`;
    if (block.scan_rate_ms < 1) return `${label} Scan Rate must be greater than zero.`;
    const start = Number(block.start);
    const end = start + Number(block.count);
    for (let previous = 0; previous < i; previous += 1) {
      const other = device.pull_blocks[previous];
      const otherStart = Number(other.start);
      const otherEnd = otherStart + Number(other.count);
      if (Number(block.function) === Number(other.function) && start < otherEnd && otherStart < end) {
        return `${label} overlaps Pull Block ${previous + 1} in FC${block.function}.`;
      }
    }
  }
  if (!device.destination.auto_port && (device.destination.port < 1 || device.destination.port > 65535)) return 'Destination Port must be between 1 and 65535.';
  if (device.destination.unit_id < 0 || device.destination.unit_id > 255) return 'Destination Unit ID must be between 0 and 255.';
  return null;
};
const replicatorState = {document: {devices: []}, persisted: {devices: []}, selected: null, selectedBlock: 0, loading: true, saving: false, message: 'Loading Replicator definitions...', error: false, runtimeError: '', runtimeStatus: null};
const selectedReplicator = () => replicatorState.selected === null ? null : replicatorState.document.devices[replicatorState.selected];
const replicatorSavedNames = new WeakMap();
const replaceReplicatorDraft = documentValue => {
  replicatorState.document = clone(documentValue);
  for (const device of replicatorState.document.devices) replicatorSavedNames.set(device, device.name);
};
const replicatorView = {editor: 'definition'};

const refreshReplicatorValidation = () => {
  const device = selectedReplicator();
  const validation = device ? validateReplicator(device) : null;
  const notice = document.getElementById('rep-validation');
  const save = document.querySelector('[data-action=rep-save]');
  if (notice) {
    notice.textContent = validation || '';
    notice.hidden = !validation;
  }
  if (save) save.disabled = Boolean(validation) || replicatorState.saving;
};

const renderReplicator = () => {
  const root = document.getElementById('replicator-root');
  root.replaceChildren();
  const shell = h('fieldset', 'tool-layout memory-fields');
  shell.disabled = replicatorState.saving;
  const sidebar = h('aside', 'tool-sidebar');
  sidebar.appendChild(h('h2', '', 'Replicator Devices'));
  const listActions = h('div', 'tool-actions');
  listActions.append(actionButton('Add', 'rep-add'), actionButton('Duplicate', 'rep-duplicate'), actionButton('Delete', 'rep-delete', 'tool-danger'));
  sidebar.appendChild(listActions);
  const list = h('div', 'tool-list');
  replicatorState.document.devices.forEach((device, index) => {
    const first = device.pull_blocks[0] || blankBlock();
    const row = actionButton('', 'rep-select', index === replicatorState.selected ? 'tool-row selected' : 'tool-row');
    row.dataset.index = String(index);
    row.append(h('strong', '', device.name || 'Unnamed device'), h('span', '', `${device.endpoint} / FC${first.function}${device.enabled ? '' : ' / Disabled'}`));
    list.appendChild(row);
  });
  if (!list.children.length) list.appendChild(h('div', 'tool-empty', replicatorState.loading ? 'Loading...' : 'No devices configured.'));
  sidebar.appendChild(list);
  shell.appendChild(sidebar);
  const editor = h('section', 'tool-editor');
  const tabs = h('nav', 'memory-subtabs');
  tabs.append(memoryTab('Device Definition', replicatorView.editor === 'definition', () => { replicatorView.editor = 'definition'; renderReplicator(); }),
    memoryTab('Advanced Settings', replicatorView.editor === 'advanced', () => { replicatorView.editor = 'advanced'; renderReplicator(); }));
  editor.appendChild(tabs);
  const device = selectedReplicator();
  if (!device) {
    editor.appendChild(h('div', 'tool-empty', 'Select a device or choose Add.'));
  } else {
    const commsStrip = window.mcsComms.create(document);
    editor.appendChild(commsStrip);
    window.mcsComms.update(commsStrip, Date.now() - replicatorStatusReceivedAt < 6000 && device.enabled ? replicatorState.runtimeStatus : null, device.name, replicatorState.runtimeError);
    if (replicatorView.editor === 'advanced') {
      const advanced = h('div', 'memory-advanced');
      window.mcsMemoryUI.mount(advanced, window.mcsMemoryUI.replicatorParams(device), {
        document, devices: advancedDevices(), outputLoaded: mmaState.loaded, outputListen: mmaState.persisted.rbe?.tcp?.listen,
        configureOutput: () => openRBEOutput('rep-mma')
      });
      editor.appendChild(advanced);
    } else {
    const identity = h('div', 'tool-grid');
    identity.append(field('Name', device.name, {type: 'text'}, value => { device.name = value; refreshReplicatorValidation(); pollReplicator(); }));
    identity.append(checkboxField('Enabled', device.enabled, value => { device.enabled = value; refreshReplicatorValidation(); }));
    identity.append(field('Endpoint', device.endpoint, {type: 'text', placeholder: '192.168.1.20:502'}, value => { device.endpoint = value; refreshReplicatorValidation(); }));
    identity.append(field('Source Unit ID', device.unit_id, {min: 0, max: 255}, value => { device.unit_id = numberValue(value); refreshReplicatorValidation(); }));
    editor.appendChild(identity);
    editor.appendChild(h('h3', '', 'Destination'));
    const destination = h('div', 'tool-grid');
    const destinationPort = field('Port', device.destination.port, {min: 1, max: 65535, readOnly: device.destination.auto_port}, value => { device.destination.port = numberValue(value); refreshReplicatorValidation(); });
    destination.append(destinationPort);
    destination.append(checkboxField('Auto Port', device.destination.auto_port, value => { device.destination.auto_port = value; destinationPort.querySelector('input').readOnly = value; refreshReplicatorValidation(); }));
    const destinationUnit = field('Unit ID', device.destination.unit_id, {min: 0, max: 255, readOnly: device.destination.auto_unit_id}, value => { device.destination.unit_id = numberValue(value); refreshReplicatorValidation(); });
    destination.append(destinationUnit);
    destination.append(checkboxField('Auto Unit ID', device.destination.auto_unit_id, value => { device.destination.auto_unit_id = value; destinationUnit.querySelector('input').readOnly = value; refreshReplicatorValidation(); }));
    editor.appendChild(destination);
    editor.appendChild(h('h3', '', 'Pull Blocks'));
    const blockActions = h('div', 'tool-actions');
    blockActions.append(actionButton('Add Block', 'rep-add-block'), actionButton('Duplicate Block', 'rep-duplicate-block'), actionButton('Delete Block', 'rep-delete-block', 'tool-danger'));
    editor.appendChild(blockActions);
    const table = h('div', 'block-table');
    const header = h('div', 'block-row block-header');
    ['#', 'FC', 'Start', 'Count', 'Scan Rate (ms)', ''].forEach(label => header.appendChild(h('span', '', label)));
    table.appendChild(header);
    device.pull_blocks.forEach((block, index) => {
      const row = h('div', index === replicatorState.selectedBlock ? 'block-row selected' : 'block-row');
      row.dataset.action = 'rep-select-block';
      row.dataset.index = String(index);
      row.appendChild(h('strong', '', String(index + 1)));
      const select = document.createElement('select');
      [1, 2, 3, 4].forEach(value => {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = `FC${value}`;
        option.selected = Number(block.function) === value;
        select.appendChild(option);
      });
      select.addEventListener('pointerdown', event => event.stopPropagation());
      select.addEventListener('mousedown', event => event.stopPropagation());
      select.addEventListener('click', event => event.stopPropagation());
      select.addEventListener('change', event => { block.function = Number(event.target.value); refreshReplicatorValidation(); });
      const selectWrap = h('span');
      selectWrap.appendChild(select);
      row.appendChild(selectWrap);
      row.appendChild(field('Start', block.start, {min: 0, max: 65535, className: 'cell-field'}, value => { block.start = numberValue(value); refreshReplicatorValidation(); }));
      row.appendChild(field('Count', block.count, {min: 1, max: 65535, className: 'cell-field'}, value => { block.count = numberValue(value); refreshReplicatorValidation(); }));
      row.appendChild(field('Scan', block.scan_rate_ms, {min: 1, step: 1, className: 'cell-field'}, value => { block.scan_rate_ms = numberValue(value); refreshReplicatorValidation(); }));
      const remove = actionButton('-', 'rep-delete-block-row', 'tool-row-delete tool-danger');
      remove.dataset.index = String(index);
      remove.title = `Delete Pull Block ${index + 1}`;
      remove.setAttribute('aria-label', remove.title);
      row.appendChild(remove);
      table.appendChild(row);
    });
    editor.appendChild(table);
    }
    const validation = validateReplicator(device);
    const validationNotice = h('div', 'tool-validation', validation || '');
    validationNotice.id = 'rep-validation';
    validationNotice.hidden = !validation;
    editor.appendChild(validationNotice);
    const actions = h('div', 'editor-actions');
    const save = actionButton(replicatorState.saving ? 'Saving...' : 'Save & Apply', 'rep-save', 'tool-primary');
    save.disabled = Boolean(validation) || replicatorState.saving;
    actions.append(save, actionButton('Discard', 'rep-discard'));
    editor.appendChild(actions);
  }
  const statusMessage = h('div', `tool-status${replicatorState.error || replicatorState.runtimeError ? ' error' : ''}`, replicatorState.runtimeError || replicatorState.message);
  statusMessage.id = 'rep-status-message';
  editor.appendChild(statusMessage);
  shell.appendChild(editor);
  root.appendChild(shell);
  renderMMADialog(root, 'rep-mma');
};
const loadReplicator = async () => {
  replicatorState.loading = true;
  replicatorState.message = 'Loading Replicator definitions...';
  replicatorState.error = false;
  renderReplicator();
  try {
    const result = await window.mcsDesktop.replicatorCall('load', {});
    const documentValue = normalizeRepDocument(result.document);
    replaceReplicatorDraft(documentValue);
    replicatorState.persisted = clone(documentValue);
    replicatorState.selected = documentValue.devices.length ? 0 : null;
    replicatorState.message = documentValue.devices.length ? 'Canonical Replicator definitions loaded.' : 'No devices configured. Choose Add to begin.';
    replicatorState.error = false;
  } catch (error) {
    replicatorState.message = error.message || String(error);
    replicatorState.error = true;
  } finally {
    replicatorState.loading = false;
    renderReplicator();
  }
};
const pollReplicator = async () => {
  const device = selectedReplicator();
  if (!device || replicatorState.saving) return;
  if (replicatorSavedNames.get(device) !== device.name) {
    ++replicatorPollVersion;
    replicatorState.runtimeStatus = null;
    replicatorState.runtimeError = '';
    const message = 'Unsaved device name — Save & Apply before checking runtime status.';
    window.mcsComms.update(document.getElementById('rep-comms'), null, device.name, message);
    const statusMessage = document.getElementById('rep-status-message');
    if (statusMessage) {
      statusMessage.textContent = replicatorState.error ? replicatorState.message : message;
      statusMessage.classList.toggle('error', replicatorState.error);
    }
    return;
  }
  const name = device.name;
  const version = ++replicatorPollVersion;
  const stillSelected = () => version === replicatorPollVersion && selectedReplicator() === device && device.name === name && !replicatorState.saving;
  try {
    const status = await window.mcsDesktop.replicatorCall('status', {name});
    if (!stillSelected()) return;
    replicatorState.runtimeStatus = status;
    replicatorStatusReceivedAt = Date.now();
    replicatorState.runtimeError = '';
    window.mcsComms.update(document.getElementById('rep-comms'), device.enabled ? status : null, name);
    const statusMessage = document.getElementById('rep-status-message');
    if (statusMessage) {
      statusMessage.textContent = replicatorState.message;
      statusMessage.classList.toggle('error', replicatorState.error);
    }
  } catch (error) {
    if (!stillSelected()) return;
    replicatorState.runtimeStatus = {unavailable: true, running: false, source_status: 'UNAVAILABLE', last_poll: ''};
    const runtimeError = `Replicator status failed for ${device.name}: ${error.message || error}`;
    if (replicatorState.runtimeError !== runtimeError) appendLog({process: 'replicator', level: 'error', text: runtimeError});
    replicatorState.runtimeError = runtimeError;
    window.mcsComms.update(document.getElementById('rep-comms'), null, name, runtimeError);
    const statusMessage = document.getElementById('rep-status-message');
    if (statusMessage) {
      statusMessage.textContent = runtimeError;
      statusMessage.classList.add('error');
    }
  }
};
const saveReplicator = async () => {
  const validation = replicatorState.document.devices.map(validateReplicator).find(Boolean);
  if (validation) {
    replicatorState.message = validation;
    replicatorState.error = true;
    renderReplicator();
    return;
  }
  replicatorState.saving = true;
  replicatorState.message = 'Saving Replicator definitions and applying runtime changes...';
  replicatorState.error = false;
  renderReplicator();
  try {
    const result = await window.mcsDesktop.replicatorCall('apply', {document: clone(replicatorState.document)});
    const documentValue = normalizeRepDocument(result.document);
    replaceReplicatorDraft(documentValue);
    replicatorState.persisted = clone(documentValue);
    replicatorState.message = `${result.message || 'Replicator settings applied.'} ${result.completed_at ? `Completed at ${formatTime(result.completed_at)}.` : ''}`;
    replicatorState.error = false;
  } catch (error) {
    replicatorState.message = `Save & Apply failed: ${error.message || error}`;
    replicatorState.error = true;
  } finally {
    replicatorState.saving = false;
    renderReplicator();
    pollReplicator();
  }
};

document.addEventListener('click', event => {
  if (isEditableControl(event.target) && !event.target.closest('button[data-action]')) return;
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'mma-save') { saveMMASettings(); return; }
  if (action === 'mma-load') { loadMMASettings(); return; }
  if (action === 'mma-discard') { if (!mmaState.saving) { mmaState.document = clone(mmaState.persisted); mmaState.error = false; mmaState.message = 'Changes discarded.'; renderMMAViews(); } return; }
  if (simulatorState.saving && action.startsWith('sim-')) return;
  if (action === 'sim-select') simulatorState.selected = Number(target.dataset.index);
  else if (action === 'sim-add') { simulatorState.document.devices.push(simulatorBlankDevice(simulatorState.document.devices.length + 1)); simulatorState.selected = simulatorState.document.devices.length - 1; }
  else if (action === 'sim-duplicate' && selectedSimulator()) {
    const copy = clone(selectedSimulator()); copy.name = `${copy.name} (copy)`;
    try {
      window.mcsMemoryUI.assignCopiedIDs(copy.mma2, advancedDevices());
      simulatorState.document.devices.push(copy); simulatorState.selected = simulatorState.document.devices.length - 1;
    } catch (error) { simulatorState.error = true; simulatorState.message = error.message; }
  }
  else if (action === 'sim-delete' && selectedSimulator()) { simulatorState.document.devices.splice(simulatorState.selected, 1); simulatorState.selected = simulatorState.document.devices.length ? Math.min(simulatorState.selected, simulatorState.document.devices.length - 1) : null; }
  else if (action === 'sim-discard') { discardSimulator(); }
  else if (action === 'sim-save') { saveSimulator(); return; }
  else if (action === 'rep-select') { replicatorState.selected = Number(target.dataset.index); replicatorState.selectedBlock = 0; }
  else if (action === 'rep-add') { replicatorState.document.devices.push(blankReplicator(replicatorState.document.devices.length + 1)); replicatorState.selected = replicatorState.document.devices.length - 1; replicatorState.selectedBlock = 0; }
  else if (action === 'rep-duplicate' && selectedReplicator()) {
    const copy = clone(selectedReplicator()); copy.name = `${copy.name} (copy)`;
    try {
      window.mcsMemoryUI.assignCopiedIDs(copy.mma2_advanced || {}, advancedDevices());
      replicatorState.document.devices.push(copy); replicatorState.selected = replicatorState.document.devices.length - 1; replicatorState.selectedBlock = 0;
    } catch (error) { replicatorState.error = true; replicatorState.message = error.message; }
  }
  else if (action === 'rep-delete' && selectedReplicator()) { replicatorState.document.devices.splice(replicatorState.selected, 1); replicatorState.selected = replicatorState.document.devices.length ? Math.min(replicatorState.selected, replicatorState.document.devices.length - 1) : null; replicatorState.selectedBlock = 0; }
  else if (action === 'rep-select-block') replicatorState.selectedBlock = Number(target.dataset.index);
  else if (action === 'rep-add-block' && selectedReplicator()) { selectedReplicator().pull_blocks.push(blankBlock()); replicatorState.selectedBlock = selectedReplicator().pull_blocks.length - 1; }
  else if (action === 'rep-duplicate-block' && selectedReplicator()) { const blocks = selectedReplicator().pull_blocks; const copy = clone(blocks[replicatorState.selectedBlock] || blocks[0] || blankBlock()); blocks.splice(replicatorState.selectedBlock + 1, 0, copy); replicatorState.selectedBlock += 1; }
  else if ((action === 'rep-delete-block' || action === 'rep-delete-block-row') && selectedReplicator()) {
    const blocks = selectedReplicator().pull_blocks;
    const index = action === 'rep-delete-block-row' ? Number(target.dataset.index) : replicatorState.selectedBlock;
    if (index !== null && index >= 0 && index < blocks.length) blocks.splice(index, 1);
    replicatorState.selectedBlock = blocks.length ? Math.min(index, blocks.length - 1) : null;
  }
  else if (action === 'rep-discard') { replaceReplicatorDraft(replicatorState.persisted); replicatorState.selected = replicatorState.document.devices.length ? Math.min(replicatorState.selected || 0, replicatorState.document.devices.length - 1) : null; replicatorState.selectedBlock = 0; replicatorState.error = false; replicatorState.message = 'Changes discarded.'; }
  else if (action === 'rep-save') { saveReplicator(); return; }
  renderSimulator();
  renderReplicator();
  pollSimulator();
  pollReplicator();
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Delete' || isEditableControl(event.target)) return;
  const device = selectedReplicator();
  const index = replicatorState.selectedBlock;
  const replicatorPanel = document.getElementById('panel-replicator');
  if (!replicatorPanel.classList.contains('active') || !device || index === null) return;
  if (index < 0 || index >= device.pull_blocks.length) return;
  device.pull_blocks.splice(index, 1);
  replicatorState.selectedBlock = device.pull_blocks.length ? Math.min(index, device.pull_blocks.length - 1) : null;
  event.preventDefault();
  renderReplicator();
  pollReplicator();
});

tabs.forEach(tab => tab.addEventListener('click', () => {
  tabs.forEach(node => node.classList.toggle('active', node === tab));
  panels.forEach(panel => panel.classList.toggle('active', panel.id === `panel-${tab.dataset.tab}`));
}));
document.getElementById('start-all').addEventListener('click', () => window.mcsDesktop.startAll());
document.getElementById('stop-all').addEventListener('click', () => window.mcsDesktop.stopAll());
window.mcsDesktop.onRuntimeStatus(setStatuses);
window.mcsDesktop.onRuntimeLog(appendLog);
Promise.all([
  window.mcsDesktop.getRuntimeStatus(),
  window.mcsDesktop.getRuntimePaths()
]).then(([status, paths]) => {
  setStatuses(status);
  runtimePaths = paths;
  document.getElementById('bin-path').textContent = paths.bin;
  document.getElementById('data-path').textContent = paths.data;
  document.getElementById('runtime-mode').textContent = paths.mode === 'isolated-review' ? 'Isolated UI review — backend connections disabled' : paths.mode === 'windows-service' ? 'Windows services (NSSM)' : 'Electron child processes';
  if (paths.mode === 'isolated-review') {
    document.title = 'MCS Modbus Toolkit — Isolated UI Review';
    document.querySelector('.subtitle').textContent = 'Isolated UI Review — private data, backends disabled';
    document.getElementById('start-all').disabled = true;
    document.getElementById('stop-all').disabled = true;
  }
  if (paths.mode === 'windows-service') {
    const startButton = document.getElementById('start-all');
    const stopButton = document.getElementById('stop-all');
    startButton.disabled = true;
    stopButton.disabled = true;
    startButton.title = 'Installed backend runtimes are managed by Windows Services.';
    stopButton.title = 'Closing Electron does not stop installed Windows services.';
    appendLog({process: 'electron', level: 'info', text: 'Backend runtimes are managed by NSSM Windows services. Use Windows Services for manual start/stop operations.'});
  }
}).catch(error => appendLog({process: 'electron', level: 'error', text: error.message || String(error)}));
renderSimulator();
renderReplicator();
loadSimulator();
loadMMASettings();
loadReplicator();
setInterval(pollSimulator, 2000);
setInterval(pollReplicator, 2000);
setInterval(() => {
  const device = selectedReplicator();
  if (device && Date.now() - replicatorStatusReceivedAt >= 6000) {
    window.mcsComms.update(document.getElementById('rep-comms'), null, device.name, 'Runtime status is stale or unavailable');
  }
}, 1000);
