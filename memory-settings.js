'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
const portOf = listener => Number(String(listener.listen || '').match(/:(\d+)$/)?.[1]);
const findMemory = (config, port, unit) => (config.listeners || [])
  .find(listener => portOf(listener) === Number(port))?.memory
  ?.find(memory => Number(memory.unit_id) === Number(unit));
const structural = new Set(['port', 'unit_id', 'coils', 'discrete_inputs', 'holding_registers', 'input_registers']);

const inheritSettings = (params, config) => {
  const result = copy(params);
  const previous = findMemory(config, params.port, params.unit_id);
  for (const [key, value] of Object.entries(previous || {})) {
    if (!structural.has(key) && !Object.hasOwn(result, key)) result[key] = copy(value);
  }
  return result;
};

const applySettings = (memory, params) => {
  for (const [key, value] of Object.entries(params)) {
    if (!['port', 'unit_id', 'fc1', 'fc2', 'fc3', 'fc4'].includes(key)) memory[key] = copy(value);
  }
  return memory;
};

const hydrateDocument = (document, config) => ({...copy(document), devices: (document.devices || [])
  .map(device => ({...copy(device), mma2: inheritSettings(device.mma2, config)}))});

const preserveListeners = (config, previous) => {
  config.listeners = config.listeners.map(listener => {
    const prior = (previous.listeners || []).find(item => portOf(item) === portOf(listener));
    return prior ? {...copy(prior), ...listener, id: prior.id, listen: prior.listen} : listener;
  });
};

const sharedSettings = config => {
  const settings = {};
  for (const key of ['rbe', 'access_events', 'debug']) {
    if (Object.hasOwn(config, key)) settings[key] = copy(config[key]);
  }
  return settings;
};

const updateSharedSettings = (config, settings) => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('MMA settings are required.');
  const updated = copy(config);
  for (const [key, value] of Object.entries(settings)) {
    if (!['rbe', 'access_events', 'debug'].includes(key)) throw new Error(`Unsupported MMA setting: ${key}`);
    if (value === null) delete updated[key];
    else updated[key] = copy(value);
  }
  return updated;
};

module.exports = {inheritSettings, applySettings, hydrateDocument, preserveListeners, sharedSettings, updateSharedSettings};
