'use strict';

const WINDOWS_SERVICES = {
  mma2: 'MCS-MMA2',
  simulator: 'MCS-Simulator',
  replicator: 'MCS-Replicator'
};

const getWindowsServiceStatus = async queryService => Object.fromEntries(
  await Promise.all(Object.entries(WINDOWS_SERVICES).map(async ([key, service]) => [key, await queryService(service)]))
);

module.exports = {getWindowsServiceStatus, WINDOWS_SERVICES};