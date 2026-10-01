const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../build/installer.nsh'), 'utf8');

test('installer offers current/all users without account entry and preserves the launch identity', () => {
  assert.match(source, /Page custom MCSSettingsPageCreate MCSSettingsPageLeave/);
  assert.match(source, /NSD_CreateRadioButton.*"Current user"/);
  assert.match(source, /NSD_CreateRadioButton.*"All users"/);
  assert.doesNotMatch(source, /NSD_CreateText|account-file|Enter the Windows account/);
  assert.match(source, /RequestExecutionLevel user/);
  assert.match(source, /UAC_AsUser_GetGlobalVar \$MCSLaunchingOwner/);
  assert.ok(source.indexOf('-mode current-user') < source.indexOf('!insertmacro UAC_RunElevated'));
  assert.match(source, /ReadRegStr \$MCSPreviousSettingsOwner HKLM "Software\\MCS Modbus Toolkit" "SettingsOwnerSID"/);
  assert.match(source, /WriteRegStr HKLM "Software\\MCS Modbus Toolkit" "SettingsOwnerSID" "\$MCSSettingsOwner"/);
  assert.match(source, /SettingsScope/);
  assert.doesNotMatch(source, /S-1-1-0|ROD\\rod/i);
});

test('installer targets config only and stops when permission setup fails', () => {
  assert.match(source, /-mode grant -config "\$MCSRuntimeRoot\\config" -owner "\$MCSSettingsOwner" -previous "\$MCSPreviousSettingsOwner"/);
  assert.match(source, /Settings permissions failed:[\s\S]*?Abort/);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.match(pkg.scripts['dist:win'], /^npm run build:settings-access && /);
});
