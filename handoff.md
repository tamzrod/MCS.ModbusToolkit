# Handoff

## Current state

Initial standalone migration completed from the former `MCS.OSJS/electron` donor into the repository root.

The migration intentionally excludes OS.js, ICC, workflow/planning history, Simulator/Replicator/MMA2 Go source trees, backup `.bak` files, and the old `build-and-push.ps1` script because that script depended on sibling source directories from the old monorepo.

No local runtime verification has been claimed yet.

## OpenCode test instruction

You are working in the standalone `MCS.ModbusToolkit` repository.

### Goal

Verify that the migrated Electron application is independently usable from this repository root. Do not redesign, refactor, add features, or silently repair failures.

### Checks

1. Inspect the repository and report any runtime/source dependency that points back to `MCS.OSJS`, `OSJS/`, `../electron/`, or another parent repository.
2. Confirm `package.json` treats this repository root as the Electron application root.
3. Run JavaScript syntax checks on production JavaScript files.
4. Install dependencies strictly from the lockfile with:
   ```bash
   npm ci
   ```
5. Run the existing test suite:
   ```bash
   node --test test/*.test.js
   ```
6. Verify Electron can resolve and launch from repository root with:
   ```bash
   npm start
   ```
   Do not modify production runtime data or host services.
7. Verify the build configuration references only files present in this repository.
8. On Windows, inspect packaging prerequisites without installing, starting, stopping, or removing Windows services.
9. Specifically report whether required runtime executables expected under `bin/` are present or absent and what that means for local development versus packaged execution.

### Required report

For every check return:

- PASS / FAIL / BLOCKED
- exact command or inspection performed
- exit code where applicable
- missing files
- stale MCS.OSJS / OS.js references
- external path dependencies
- required corrective changes

### Restrictions

- No feature work.
- No UI redesign.
- No service installation or service control.
- No production data modification.
- No changes outside this repository.
- Do not silently repair failures.
- Stop after reporting verification results.
