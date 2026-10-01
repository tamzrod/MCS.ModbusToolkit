'use strict';

const createReplicatorCall = ({load, apply, status}) => {
  if (![load, apply, status].every(handler => typeof handler === 'function')) {
    throw new Error('Replicator IPC handlers are required');
  }
  return async (operation, payload = {}) => {
    if (operation === 'load') return {document: await load()};
    if (operation === 'apply') return apply(payload.document);
    if (operation === 'status') return status(payload);
    throw new Error('Unsupported Replicator operation ' + operation);
  };
};

module.exports = {createReplicatorCall};