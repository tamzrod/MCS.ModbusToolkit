'use strict';

const fs = require('fs');
const path = require('path');
const {execFile} = require('child_process');

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, {windowsHide: true, timeout: 12000, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => {
    if (error) reject(error); else resolve(stdout);
  });
});

const collectListeners = async () => {
  if (process.platform !== 'win32') throw new Error('Port ownership inspection is available on Windows only.');
  const script = "$ErrorActionPreference='Stop'; $rows=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { $owner=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{address=$_.LocalAddress; port=$_.LocalPort; pid=$_.OwningProcess; process=$owner.ProcessName} }); ConvertTo-Json -InputObject $rows -Compress";
  return JSON.parse(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]));
};

const readTail = (file, limit = 65536) => {
  const descriptor = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    const buffer = Buffer.alloc(Math.min(size, limit));
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, Math.max(0, size - limit));
    const text = buffer.subarray(0, count).toString('utf8');
    return size > limit ? '[Earlier log content omitted]\n' + text.slice(text.indexOf('\n') + 1) : text;
  } finally { fs.closeSync(descriptor); }
};

const configuredPorts = config => {
  const ports = (config.listeners || []).map(listener => ({kind: 'Modbus / Raw Ingest', listen: listener.listen, units: (listener.memory || []).map(memory => memory.unit_id).join(', ')}));
  if (config.rbe?.tcp) ports.push({kind: 'RBE TCP', listen: config.rbe.tcp.listen, units: '—'});
  if (config.access_events?.enabled && config.access_events.output?.listen) ports.push({kind: 'Access events', listen: config.access_events.output.listen, units: '—'});
  return ports;
};

const inspectPorts = (config, listeners) => configuredPorts(config).map(entry => {
  const match = String(entry.listen || '').match(/^(.*):(\d+)$/);
  if (!match) return {...entry, state: 'Invalid listen address', owners: []};
  const host = match[1].replace(/^\[|\]$/g, '');
  const owners = listeners === null ? [] : listeners.filter(row => Number(row.port) === Number(match[2]) &&
    (!host || host === '0.0.0.0' || host === '::' || row.address === host || row.address === '0.0.0.0' || row.address === '::'));
  let state = 'Not listening';
  if (listeners === null) state = 'Unavailable';
  else if (owners.length) state = owners.every(owner => /^mma2(?:\.exe)?$/i.test(owner.process || '')) ? 'MMA2 listener observed' : 'Owner needs review';
  return {...entry, state, owners};
});

const snapshot = async ({root, config, services, isolated = false, listenerQuery = collectListeners, sessionLogs = []}) => {
  const problems = [];
  let listeners = null;
  if (isolated) problems.push('Isolated review: live service and port checks are disabled.');
  else {
    try { listeners = await listenerQuery(); }
    catch (error) { problems.push('Port inspection unavailable: ' + error.message); }
  }
  for (const [name, status] of Object.entries(services)) {
    if (status !== 'RUNNING') problems.push(`${name}: ${status}. Check Windows Services and the backend logs.`);
  }
  const ports = inspectPorts(config, listeners);
  for (const port of ports) {
    if (port.state === 'Not listening') problems.push(`${port.kind} ${port.listen}: no matching TCP listener. Check startup/bind errors in logs.`);
    if (port.state === 'Owner needs review') problems.push(`${port.kind} ${port.listen}: another or unidentified process holds a matching port. Review PID/address before changing settings; no process was stopped.`);
    if (port.state === 'Invalid listen address') problems.push(`${port.kind}: invalid listen address ${port.listen || '(empty)'}. Correct it in settings.`);
  }
  const hasRules = (config.listeners || []).some(listener => (listener.memory || []).some(memory => Object.values(memory.rbe || {}).some(rules => Array.isArray(rules) && rules.length)));
  if (hasRules && !config.rbe?.tcp?.listen) problems.push('RBE rules exist without a TCP output listener. Configure RBE TCP Settings under Advanced Settings.');
  const logs = [];
  for (const service of ['MCS-MMA2', 'MCS-Simulator', 'MCS-Replicator']) {
    for (const stream of ['stdout', 'stderr']) {
      const file = path.join(root, 'logs', `${service}.${stream}.log`);
      try { logs.push({source: `${service}/${stream}`, text: readTail(file)}); }
      catch (error) { logs.push({source: `${service}/${stream}`, unavailable: error.code === 'ENOENT' ? 'No log file yet. Older installations need the updated installer to enable service log capture.' : error.message}); }
    }
  }
  if (sessionLogs.length) logs.push({source: 'Desktop child processes', text: sessionLogs.join('\n')});
  return {at: new Date().toISOString(), services, problems, ports, logs,
    note: 'Read-only snapshot. A listening port does not prove valid Modbus replies, RBE delivery, or successful configuration activation. Logs may contain older errors.'};
};

module.exports = {snapshot, inspectPorts, readTail, collectListeners};
