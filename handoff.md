# Handoff

## Current state

Repository reorganized as a multi-target MCS Modbus Toolkit product family.

The migrated Electron implementation now lives entirely under `desktop/`.

Reserved target directories:

- `mobile/` — future mobile-specific implementation
- `shared/` — future shared contracts/formats only
- `docs/` — product-level documentation

No local runtime verification has been claimed yet. Perform the desktop verification on the Windows development machine.

## OpenCode test instruction

Work only in this repository. The current implementation under test is `desktop/`.

### Goal

Verify that the migrated Electron desktop application is independently usable from `desktop/`. Do not redesign, refactor, add features, or silently repair failures.

### Checks

1. From repository root, inspect for runtime/source dependencies that point back to `MCS.OSJS`, `OSJS/`, the former root layout, or another parent repository.
2. Change directory to:
   ```powershell
   cd desktop
   ```
3. Confirm `desktop/package.json` treats `desktop/` as the Electron application root.
4. Run JavaScript syntax checks on production JavaScript files.
5. Install dependencies strictly from the lockfile:
   ```powershell
   npm ci
   ```
6. Run the existing test suite:
   ```powershell
   node --test test/*.test.js
   ```
7. Verify Electron can resolve and launch:
   ```powershell
   npm start
   ```
   Do not modify production runtime data or host services.
8. Verify build configuration references only files available to this standalone repository/deployment.
9. Inspect Windows packaging prerequisites without installing, starting, stopping, or removing Windows services.
10. Report whether runtime executables expected under `desktop/bin/` are present or absent and distinguish local-development blockers from packaged-runtime blockers.

### Required report

For every check return PASS / FAIL / BLOCKED, exact command or inspection, exit code where applicable, missing files, stale old-layout or MCS.OSJS references, external path dependencies, and required corrective changes.

### Restrictions

- No feature work.
- No UI redesign.
- No service installation or service control.
- No production data modification.
- No changes outside this repository.
- Do not silently repair failures.
- Stop after reporting verification results.
