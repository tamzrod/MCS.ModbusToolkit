'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {getWindowsServiceStatus} = require('../runtime-status');

test('reports each actual Windows service state without fabricated health', async () => {
  const states = {
    'MCS-MMA2': 'RUNNING',
    'MCS-Simulator': 'STOPPED',
    'MCS-Replicator': 'NOT INSTALLED'
  };
  const queried = [];
  const result = await getWindowsServiceStatus(async service => {
    queried.push(service);
    return states[service];
  });

  assert.deepEqual(result, {mma2: 'RUNNING', simulator: 'STOPPED', replicator: 'NOT INSTALLED'});
  assert.deepEqual(queried.sort(), Object.keys(states).sort());
});