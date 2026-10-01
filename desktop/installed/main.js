const {app, BrowserWindow, ipcMain} = require('electron');
const {spawn, execFile, execFileSync} = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const yaml = require('js-yaml');
const {callReplicatorRuntime, applyReplicatorRuntime} = require('./replicator-runtime');
const {createReplicatorCall} = require('./replicator-ipc');
const {getWindowsServiceStatus} = require('./runtime-status');
const memorySettings = require('./memory-settings');
const diagnostics = require('./diagnostics');
const diagnosticSessionLogs = [];
const reviewRoot = process.env.MCS_REVIEW_DATA_ROOT ? path.resolve(process.env.MCS_REVIEW_DATA_ROOT) : null;
if (reviewRoot) app.setPath('userData', path.join(reviewRoot, 'electron-profile'));

let mainWindow = null;
let statusTimer = null;
const children = new Map();
const simulatorTimers = new Map();
const simulatorRuntime = new Map();

const windowsServiceMode = () => !reviewRoot && app.isPackaged && process.platform === 'win32';
const binRoot = () => app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'bin');
const dataRoot = () => reviewRoot || (windowsServiceMode()
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'MCS Modbus Toolkit', 'runtime')
  : path.join(app.getPath('userData'), 'runtime'));
const executableName = name => process.platform === 'win32' ? `${name}.exe` : name;

const processSpecs = [
  {key: 'mma2', file: executableName('mma2'), service: 'MCS-MMA2'},
  {key: 'simulator', file: executableName('modbus-simulator-runtime'), service: 'MCS-Simulator'},
  {key: 'replicator', file: executableName('modbus-replicator-runtime'), service: 'MCS-Replicator'}
];

const paths = () => {
  const root = dataRoot();
  return {
    root,
    simulatorDevices: path.join(root, 'config', 'simulator', 'devices.yaml'),
    replicatorDevices: path.join(root, 'config', 'replicator', 'devices.yaml'),
    mma2Config: path.join(root, 'config', 'mma2', 'config.yaml'),
    mma2Owners: path.join(root, 'config', 'mma2', 'owners.yaml'),
    mma2RestartRequest: path.join(root, 'config', 'mma2', 'restart-request.yaml'),
    mma2RestartAck: path.join(root, 'config', 'mma2', 'restart-ack')
  };
};

const readYaml = (file, fallback) => {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return yaml.load(text) || fallback;
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
};

const writeYamlAtomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const body = yaml.dump(value, {lineWidth: 120, noRefs: true});
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
  return body;
};

const normalizeDocument = value => ({devices: Array.isArray(value && value.devices) ? value.devices : []});
const clone = value => JSON.parse(JSON.stringify(value));
const num = value => Number(value) || 0;
const hasArea = area => area && num(area.count) > 0;

const validateSimulatorDevice = device => {
  if (!device.name || !String(device.name).trim()) throw new Error('Name is required.');
  if (num(device.mma2 && device.mma2.port) < 1 || num(device.mma2.port) > 65535) throw new Error(`${device.name}: Listen Port must be between 1 and 65535.`);
  if (num(device.mma2.unit_id) < 0 || num(device.mma2.unit_id) > 255) throw new Error(`${device.name}: Unit ID must be between 0 and 255.`);
  for (const key of ['fc1', 'fc2', 'fc3', 'fc4']) {
    const area = device.mma2[key] || {};
    if (num(area.start) < 0 || num(area.start) > 65535 || num(area.count) < 0 || num(area.count) > 65535) throw new Error(`${device.name}: ${key} is outside the 16-bit address range.`);
    if (num(area.start) + num(area.count) > 65536) throw new Error(`${device.name}: ${key} Start + Count exceeds the 16-bit address space.`);
  }
};

const validateReplicatorDevice = device => {
  if (!device.name || !String(device.name).trim()) throw new Error('Name is required.');
  if (!device.endpoint || !String(device.endpoint).includes(':')) throw new Error(`${device.name}: Endpoint must be host:port.`);
  if (num(device.unit_id) < 0 || num(device.unit_id) > 255) throw new Error(`${device.name}: Source Unit ID must be between 0 and 255.`);
  const blocks = Array.isArray(device.pull_blocks) ? device.pull_blocks : [];
  if (!blocks.length) throw new Error(`${device.name}: At least one Pull Block is required.`);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (![1, 2, 3, 4].includes(num(block.function))) throw new Error(`${device.name}: Pull Block Function must be FC1, FC2, FC3, or FC4.`);
    if (num(block.start) < 0 || num(block.start) > 65535 || num(block.count) < 1 || num(block.start) + num(block.count) > 65536) throw new Error(`${device.name}: Pull Block range is invalid.`);
    if (num(block.scan_rate_ms) < 1) throw new Error(`${device.name}: Scan Rate must be greater than zero.`);

    const start = num(block.start);
    const end = start + num(block.count);

    for (let previous = 0; previous < index; previous += 1) {
      const other = blocks[previous];
      const otherStart = num(other.start);
      const otherEnd = otherStart + num(other.count);

      if (num(block.function) === num(other.function) && start < otherEnd && otherStart < end) {
        throw new Error(`${device.name}: Pull Blocks ${previous + 1} and ${index + 1} overlap in FC${num(block.function)}.`);
      }
    }
  }
};

const listenPort = listen => {
  const match = String(listen || '').match(/:(\d+)$/);
  return match ? Number(match[1]) : 0;
};

const dropProducer = (cfg, owners, producer) => {
  const owned = new Set((owners.reservations || []).filter(item => item.owner === producer).map(item => `${item.port}/${item.unit_id}`));
  owners.reservations = (owners.reservations || []).filter(item => item.owner !== producer);
  cfg.listeners = (cfg.listeners || []).map(listener => {
    const port = listenPort(listener.listen);
    const memory = (listener.memory || []).filter(mem => !owned.has(`${port}/${mem.unit_id}`));
    return {...listener, memory};
  }).filter(listener => (listener.memory || []).length > 0 || (listener.memory || []).length === (listener.memory || []).length && listenPort(listener.listen) === 0);
};

const assertNoCollision = (owners, port, unitID, producer) => {
  const collision = (owners.reservations || []).find(item => num(item.port) === num(port) && num(item.unit_id) === num(unitID) && item.owner !== producer);
  if (collision) throw new Error(`MMA2 reservation (${port},${unitID}) is owned by ${collision.owner}.`);
};

const addMemory = (cfg, id, port, memory) => {
  cfg.listeners = Array.isArray(cfg.listeners) ? cfg.listeners : [];
  const listen = `0.0.0.0:${port}`;
  const existing = cfg.listeners.find(listener => listenPort(listener.listen) === num(port));
  if (existing) {
    existing.memory = Array.isArray(existing.memory) ? existing.memory : [];
    existing.memory.push(memory);
  } else {
    cfg.listeners.push({id, listen, memory: [memory]});
  }
};

const simMemory = params => {
  const memory = {unit_id: num(params.unit_id)};
  if (hasArea(params.fc1)) memory.coils = {start: num(params.fc1.start), count: num(params.fc1.count)};
  if (hasArea(params.fc2)) memory.discrete_inputs = {start: num(params.fc2.start), count: num(params.fc2.count)};
  if (hasArea(params.fc3)) memory.holding_registers = {start: num(params.fc3.start), count: num(params.fc3.count)};
  if (hasArea(params.fc4)) memory.input_registers = {start: num(params.fc4.start), count: num(params.fc4.count)};
  memory.policy = {rules: [{id: 'simulator-fc-access', source_ip: ['0.0.0.0/0', '::/0', '127.0.0.1', '::1'], allow_fc: [1, 2, 3, 4, 5, 6, 15, 16]}]};
  return memorySettings.applySettings(memory, params);
};

const unionArea = (current, start, count) => {
  if (!current) return {start: num(start), count: num(count)};
  const lo = Math.min(num(current.start), num(start));
  const hi = Math.max(num(current.start) + num(current.count), num(start) + num(count));
  return {start: lo, count: hi - lo};
};

const repMemory = device => {
  const memory = {unit_id: num(device.destination.unit_id)};
  for (const block of device.pull_blocks || []) {
    if (num(block.function) === 1) memory.coils = unionArea(memory.coils, block.start, block.count);
    if (num(block.function) === 2) memory.discrete_inputs = unionArea(memory.discrete_inputs, block.start, block.count);
    if (num(block.function) === 3) memory.holding_registers = unionArea(memory.holding_registers, block.start, block.count);
    if (num(block.function) === 4) memory.input_registers = unionArea(memory.input_registers, block.start, block.count);
  }
  memory.policy = {rules: [{id: 'replicator-fc-access', source_ip: ['0.0.0.0/0', '::/0', '127.0.0.1', '::1'], allow_fc: [1, 2, 3, 4, 5, 6, 15, 16]}]};
  return memory;
};

const writeRestartRequest = cfg => {
  const p = paths();
  const body = yaml.dump(cfg, {lineWidth: 120, noRefs: true});
  const sum = crypto.createHash('sha256').update(body).digest('hex');
  try { fs.rmSync(p.mma2RestartAck, {force: true}); } catch (_) {}
  writeYamlAtomic(p.mma2RestartRequest, {requested_at: new Date().toISOString(), reason: 'Electron desktop shared MMA2 configuration commit', config_sha256: sum, ports: (cfg.listeners || []).map(l => listenPort(l.listen)).filter(Boolean)});
};

const composeAll = (simDoc, repDoc) => {
  const p = paths();
  const cfg = readYaml(p.mma2Config, {listeners: []});
  const previous = clone(cfg);
  const owners = readYaml(p.mma2Owners, {reservations: []});
  cfg.listeners = Array.isArray(cfg.listeners) ? cfg.listeners : [];
  owners.reservations = Array.isArray(owners.reservations) ? owners.reservations : [];
  dropProducer(cfg, owners, 'simulator');
  dropProducer(cfg, owners, 'replicator');

  const seen = new Set();
  for (const device of simDoc.devices || []) {
    device.mma2 = memorySettings.inheritSettings(device.mma2, previous);
    validateSimulatorDevice(device);
    if (!device.enabled) continue;
    const mma2 = device.mma2 || {};
    if (!['fc1', 'fc2', 'fc3', 'fc4'].some(key => hasArea(mma2[key]))) continue;
    assertNoCollision(owners, mma2.port, mma2.unit_id, 'simulator');
    const key = `${mma2.port}/${mma2.unit_id}`;
    if (seen.has(key)) throw new Error(`Duplicate simulator MMA2 reservation ${key}.`);
    seen.add(key);
    addMemory(cfg, `sim-${mma2.port}-${mma2.unit_id}`, mma2.port, simMemory(mma2));
    owners.reservations.push({port: num(mma2.port), unit_id: num(mma2.unit_id), owner: 'simulator'});
  }

  for (const device of repDoc.devices || []) {
    validateReplicatorDevice(device);
    if (!device.enabled) continue;
    device.destination = device.destination || {port: 5021, unit_id: 1};
    assertNoCollision(owners, device.destination.port, device.destination.unit_id, 'replicator');
    const params = memorySettings.inheritSettings({...device.mma2_advanced, port: device.destination.port, unit_id: device.destination.unit_id}, previous);
    addMemory(cfg, `replicator-${device.destination.port}-${device.destination.unit_id}`, device.destination.port, memorySettings.applySettings(repMemory(device), params));
    owners.reservations.push({port: num(device.destination.port), unit_id: num(device.destination.unit_id), owner: 'replicator'});
    device.destination.owner = 'replicator';
    device.destination.status = 'OWNED';
  }

  memorySettings.preserveListeners(cfg, previous);
  validateMMA2(cfg);
  writeYamlAtomic(p.mma2Config, cfg);
  writeYamlAtomic(p.mma2Owners, owners);
  writeRestartRequest(cfg);
};

const loadSimulator = () => memorySettings.hydrateDocument(normalizeDocument(readYaml(paths().simulatorDevices, {devices: []})), readYaml(paths().mma2Config, {listeners: []}));
const loadReplicator = () => normalizeDocument(readYaml(paths().replicatorDevices, {devices: []}));

const validateMMA2 = config => {
  try {
    execFileSync(path.join(binRoot(), executableName('mma2')), ['--validate-stdin'], {
      input: yaml.dump(config, {lineWidth: 120, noRefs: true}), encoding: 'utf8',
      windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024
    });
  } catch (error) {
    throw new Error(`MMA2 validation failed: ${String(error.stderr || error.message).trim()}`);
  }
};

const applyMMASettings = settings => {
  const config = memorySettings.updateSharedSettings(readYaml(paths().mma2Config, {listeners: []}), settings);
  validateMMA2(config);
  writeYamlAtomic(paths().mma2Config, config);
  writeRestartRequest(config);
  return {settings: memorySettings.sharedSettings(config), message: reviewRoot ? 'MMA settings saved to isolated review data. Backend not started.' : 'MMA settings saved; restart requested.'};
};

const applySimulator = doc => {
  const simDoc = normalizeDocument(doc);
  const repDoc = loadReplicator();
  composeAll(simDoc, repDoc);
  writeYamlAtomic(paths().simulatorDevices, simDoc);
  resetSimulatorSchedulers(simDoc);
  const randomEnabled = (simDoc.devices || []).some(device => device.enabled && ['fc1', 'fc2', 'fc3', 'fc4'].some(fc => hasArea(areaFor(device, fc)) && intervalFor(device, fc) > 0));
  const message = randomEnabled
    ? 'Memory settings saved, MMA2 restart requested, and random value publishing started.'
    : 'Memory settings saved, MMA2 restart requested. Random value publishing is not required.';
  return {document: simDoc, message: reviewRoot ? 'Memory settings saved to isolated review data. Backend not started.' : message, completed_at: new Date().toISOString()};
};


const portStatus = port => new Promise(resolve => {
  if (!port) return resolve('STOPPED');
  const socket = net.createConnection({host: '127.0.0.1', port: num(port)});
  socket.setTimeout(250);
  socket.on('connect', () => { socket.destroy(); resolve('RUNNING'); });
  socket.on('timeout', () => { socket.destroy(); resolve('STOPPED'); });
  socket.on('error', () => resolve('STOPPED'));
});
const intervalFor = (device, fc) => num(device.random_runtime && device.random_runtime[`${fc}_interval_ms`]);

const areaFor = (device, fc) => device.mma2 && device.mma2[fc] || {start: 0, count: 0};

const rawAreaCode = fc => ({fc1: 1, fc2: 2, fc3: 3, fc4: 4}[fc]);

const encodeRawIngest = (unitID, area, start, values) => {
  const bitArea = area === 1 || area === 2;
  const count = values.length;
  const payloadLength = bitArea ? Math.ceil(count / 8) : count * 2;
  const packet = Buffer.alloc(10 + payloadLength);
  packet[0] = 'R'.charCodeAt(0);
  packet[1] = 'I'.charCodeAt(0);
  packet[2] = 0x01;
  packet[3] = area;
  packet.writeUInt16BE(num(unitID), 4);
  packet.writeUInt16BE(num(start), 6);
  packet.writeUInt16BE(count, 8);
  if (bitArea) {
    values.forEach((value, index) => {
      if (value) packet[10 + Math.floor(index / 8)] |= 1 << (index % 8);
    });
  } else {
    values.forEach((value, index) => packet.writeUInt16BE(value, 10 + index * 2));
  }
  return packet;
};

const sendRawIngest = (device, fc, values) => new Promise((resolve, reject) => {
  const area = areaFor(device, fc);
  const packet = encodeRawIngest(device.mma2.unit_id, rawAreaCode(fc), area.start, values);
  const socket = net.createConnection({host: '127.0.0.1', port: num(device.mma2.port)});
  const timeout = setTimeout(() => socket.destroy(new Error('raw ingest timed out')), 5000);
  socket.on('connect', () => socket.write(packet));
  socket.on('data', chunk => {
    clearTimeout(timeout);
    socket.destroy();
    if (chunk[0] === 0x00) resolve();
    else reject(new Error(`raw ingest rejected: response code 0x${chunk[0].toString(16).padStart(2, '0')}`));
  });
  socket.on('error', error => {
    clearTimeout(timeout);
    reject(error);
  });
});

const randomValues = (fc, count) => {
  const values = [];
  for (let i = 0; i < count; i += 1) {
    values.push(fc === 'fc1' || fc === 'fc2' ? Math.random() >= 0.5 : Math.floor(Math.random() * 65536));
  }
  return values;
};

const simulatorRuntimeFor = name => {
  if (!simulatorRuntime.has(name)) simulatorRuntime.set(name, {raw_ingest_status: 'WAITING', fc: {}});
  return simulatorRuntime.get(name);
};

const fireSimulatorFC = async (device, fc) => {
  const area = areaFor(device, fc);
  const interval = intervalFor(device, fc);
  if (!device.enabled || !hasArea(area) || interval <= 0) return;
  const runtime = simulatorRuntimeFor(device.name);
  runtime.fc[fc] = runtime.fc[fc] || {};
  runtime.fc[fc].next = new Date(Date.now() + interval).toISOString();
  try {
    await sendRawIngest(device, fc, randomValues(fc, num(area.count)));
    runtime.raw_ingest_status = 'OK';
    runtime.raw_ingest_error = '';
    runtime.fc[fc].last = new Date().toISOString();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime:activity', {process: 'simulator', at: Date.now()});
  } catch (error) {
    runtime.raw_ingest_status = 'ERROR';
    runtime.raw_ingest_error = error.message || String(error);
  }
};

const resetSimulatorSchedulers = doc => {
  for (const timer of simulatorTimers.values()) clearInterval(timer);
  simulatorTimers.clear();
  simulatorRuntime.clear();
  if (reviewRoot) return;
  for (const device of doc.devices || []) {
    if (!device.enabled || !device.mma2) continue;
    for (const fc of ['fc1', 'fc2', 'fc3', 'fc4']) {
      const area = areaFor(device, fc);
      const interval = intervalFor(device, fc);
      if (!hasArea(area) || interval <= 0) continue;
      const key = `${device.name}:${fc}`;
      const runtime = simulatorRuntimeFor(device.name);
      runtime.fc[fc] = {last: 'Never', next: new Date(Date.now() + interval).toISOString()};
      simulatorTimers.set(key, setInterval(() => void fireSimulatorFC(clone(device), fc), interval));
      setTimeout(() => void fireSimulatorFC(clone(device), fc), Math.min(250, interval));
    }
  }
};

const childStatus = key => {
  const child = children.get(key);
  return child && !child.killed ? 'RUNNING' : 'STOPPED';
};

const queryWindowsService = service => new Promise(resolve => {
  execFile('sc.exe', ['query', service], {windowsHide: true}, (error, stdout = '') => {
    if (error) return resolve('NOT INSTALLED');
    resolve(/STATE\s*:\s*\d+\s+RUNNING/i.test(stdout) ? 'RUNNING' : 'STOPPED');
  });
});

const getStatus = async () => {
  if (windowsServiceMode()) return getWindowsServiceStatus(queryWindowsService);
  return Object.fromEntries(processSpecs.map(spec => [spec.key, childStatus(spec.key)]));
};

const sendStatus = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('runtime:status', await getStatus());
};

const startProcess = spec => {
  if (reviewRoot || windowsServiceMode() || children.has(spec.key)) return;
  const file = path.join(binRoot(), spec.file);
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(dataRoot(), {recursive: true});
  const child = spawn(file, [], {cwd: dataRoot(), windowsHide: true, env: {...process.env, MCS_DATA_ROOT: dataRoot()}, stdio: ['ignore', 'pipe', 'pipe']});
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', data => {
    const text = `[${new Date().toISOString()}] ${spec.key}/${stream}: ${data.toString().slice(-8192)}`;
    diagnosticSessionLogs.push(text);
    if (diagnosticSessionLogs.length > 200) diagnosticSessionLogs.shift();
  });
  children.set(spec.key, child);
  child.on('exit', () => { children.delete(spec.key); void sendStatus(); });
};

const startAll = () => {
  if (windowsServiceMode()) return false;
  processSpecs.forEach(startProcess);
  return true;
};

const stopAll = () => {
  if (windowsServiceMode()) return false;
  for (const [key, child] of children.entries()) {
    try { child.kill(); } catch (_) {}
    children.delete(key);
  }
  return true;
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 560,
    minWidth: 760,
    minHeight: 460,
    title: reviewRoot ? 'MCS Modbus Toolkit — Isolated UI Review' : 'MCS Modbus Toolkit',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#c0c0c0',
    autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false}
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
};

ipcMain.handle('runtime:get-status', getStatus);
let pendingDiagnostics = null;
ipcMain.handle('runtime:diagnostics', () => {
  if (!pendingDiagnostics) pendingDiagnostics = (async () => diagnostics.snapshot({root: dataRoot(),
    config: readYaml(paths().mma2Config, {listeners: []}), services: reviewRoot ? {} : await getStatus(),
    isolated: Boolean(reviewRoot), sessionLogs: diagnosticSessionLogs.slice()}))().finally(() => { pendingDiagnostics = null; });
  return pendingDiagnostics;
});
ipcMain.handle('runtime:get-paths', () => ({bin: binRoot(), data: dataRoot(), mode: reviewRoot ? 'isolated-review' : windowsServiceMode() ? 'windows-service' : 'child-process'}));
ipcMain.handle('runtime:start-all', () => startAll());
ipcMain.handle('runtime:stop-all', () => { const changed = stopAll(); void sendStatus(); return changed; });
ipcMain.handle('runtime:simulator-call', async (_event, operation, payload) => {
  if (operation === 'mma-load') return {settings: memorySettings.sharedSettings(readYaml(paths().mma2Config, {listeners: []}))};
  if (operation === 'mma-apply') return applyMMASettings(payload.settings);
  if (operation === 'load') return {document: loadSimulator()};
  if (operation === 'apply') return applySimulator(payload.document);
  if (operation === 'status') {
    if (reviewRoot) return {status: {name: payload.name, mma2_status: 'NOT STARTED', device_status: 'REVIEW ONLY', raw_ingest_status: 'NOT STARTED', fc: {}}};
    const device = loadSimulator().devices.find(item => item.name === payload.name);
    const runtime = device ? simulatorRuntimeFor(device.name) : {raw_ingest_status: 'STOPPED', fc: {}};
    const mma2 = await portStatus(device && device.mma2 && device.mma2.port);
    const randomRequired = Boolean(device && device.enabled && ['fc1', 'fc2', 'fc3', 'fc4'].some(fc => hasArea(areaFor(device, fc)) && intervalFor(device, fc) > 0));
    const running = mma2 === 'RUNNING' && runtime.raw_ingest_status === 'OK';
    const deviceStatus = !randomRequired && mma2 === 'RUNNING' ? 'IDLE' : (running ? 'RUNNING' : 'WAITING');
    return {status: {name: payload.name, mma2_status: mma2, device_status: deviceStatus, raw_ingest_status: randomRequired ? runtime.raw_ingest_status : 'NOT REQUIRED', raw_ingest_error: runtime.raw_ingest_error || '', fc: runtime.fc || {}}};
  }
  throw new Error(`Unsupported Simulator operation ${operation}`);
});
const replicatorCall = createReplicatorCall({
  load: async () => (await callReplicatorRuntime(dataRoot(), 'load')).document,
  apply: document => applyReplicatorRuntime(dataRoot(), document),
  status: payload => callReplicatorRuntime(dataRoot(), 'status', payload)
});
ipcMain.handle('runtime:replicator-call', (_event, operation, payload) => {
  if (reviewRoot) {
    if (operation === 'load') return {document: {devices: []}};
    throw new Error('Replicator runtime connections are disabled in isolated UI review.');
  }
  return replicatorCall(operation, payload);
});

app.whenReady().then(() => {
  createWindow();
  fs.mkdirSync(dataRoot(), {recursive: true});
  if (!windowsServiceMode()) resetSimulatorSchedulers(loadSimulator());
  statusTimer = setInterval(() => void sendStatus(), 2000);
  if (!windowsServiceMode()) startAll();
  void sendStatus();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  if (statusTimer) clearInterval(statusTimer);
  for (const timer of simulatorTimers.values()) clearInterval(timer);
  simulatorTimers.clear();
  if (!windowsServiceMode()) stopAll();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
