'use strict';
const fs = require('node:fs');
const path = require('node:path');
const files = ['mma2.exe', 'modbus-simulator-runtime.exe', 'modbus-replicator-runtime.exe'];
const missing = files.filter(file => !fs.existsSync(path.join(__dirname, '..', 'bin', file)));
if (missing.length) {
  console.error('Portable packaging requires backend binaries in bin/:\n' + missing.join('\n'));
  process.exitCode = 1;
}
