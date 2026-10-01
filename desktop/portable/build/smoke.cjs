'use strict';

// Exercise the real Electron main/preload/renderer without connecting to backends.
const {app} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.MCS_REVIEW_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mcs-portable-smoke-'));
const resultFile = path.join(__dirname, '..', 'dist', 'smoke-result.json');
fs.mkdirSync(path.dirname(resultFile), {recursive: true});
fs.writeFileSync(resultFile, JSON.stringify({status: 'running'}));
let finished = false;
const finish = (code, message) => {
  if (finished) return;
  finished = true;
  fs.writeFileSync(resultFile, JSON.stringify({code, message, at: new Date().toISOString()}, null, 2));
  console.log(message);
  app.exit(code);
};
setTimeout(() => finish(1, 'FAIL: Electron smoke test timed out'), 20000);
process.on('uncaughtException', error => finish(1, error.stack));
process.on('unhandledRejection', error => finish(1, String(error)));
app.on('browser-window-created', (_event, window) => {
  window.hide();
  window.webContents.once('did-fail-load', (_event, code, description) => finish(1, `FAIL: ${code}: ${description}`));
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const paths = await window.mcsDesktop.getRuntimePaths();
        const status = await window.mcsDesktop.getRuntimeStatus();
        return {paths, status, panels: document.querySelectorAll('[id^="panel-"]').length};
      })()`);
      if (result.paths.mode !== 'isolated-review') throw new Error('Backend isolation is not active');
      if (!Object.values(result.status).every(state => state === 'STOPPED')) throw new Error('Unexpected backend state');
      if (!result.panels) throw new Error('UI panels did not load');
      finish(0, 'PASS: Electron main, preload, renderer and runtime IPC loaded in isolated mode. ' + JSON.stringify(result));
    } catch (error) { finish(1, error.stack); }
  });
});
require('../main');
