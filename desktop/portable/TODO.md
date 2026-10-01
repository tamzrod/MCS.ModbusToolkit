# MCS Modbus Toolkit — Portable TODO

## Goal

Create a portable Windows desktop edition of MCS Modbus Toolkit with the same Toolkit capabilities as the installed edition, but without Windows service installation or NSSM.

Target runtime model:

```text
Electron
├── MMA2 child process
├── Modbus Simulator child process
└── Modbus Replicator child process
```

Closing the portable Toolkit must cleanly stop the child processes it started.

## TODO

- [x] Establish `portable/` as an independent Electron application root.
- [ ] Reuse only product behavior/contracts that should remain common with the installed edition.
- [ ] Bundle `mma2.exe`, `modbus-simulator-runtime.exe`, and `modbus-replicator-runtime.exe`.
- [x] Remove NSSM from the portable runtime and packaging path.
- [x] Do not create, modify, start, stop, or remove Windows services.
- [x] Implement child-process startup for MMA2, Simulator, and Replicator.
- [x] Track process ownership so the Toolkit stops only processes it started.
- [ ] Implement graceful shutdown with forced termination only as a fallback.
- [x] Define a portable data/config directory that stays with the portable package where practical.
- [ ] Ensure multiple copies cannot accidentally fight over the same ports/data directory.
- [x] Adapt runtime status and diagnostics to child-process mode.
- [ ] Preserve Simulator, Replicator, memory-management, communications-status, and diagnostics functionality.
- [ ] Define portable logging and bounded log retention.
- [ ] Build a portable Windows distribution with no installer requirement.
- [ ] Verify the package runs on a clean Windows machine without Node.js, Go, NSSM, or service installation.
- [ ] Add automated tests for startup, shutdown, missing binaries, port conflicts, config persistence, and abnormal child-process exits.
- [x] Document differences between Installed and Portable editions.

The initial foundation is implemented; checked implementation tasks are covered
by automated tests where applicable, not real backend integration verification.
See `README.md` for release blockers, including Windows graceful shutdown,
MMA2 reload and conflicts between different portable copies. Logging is currently
bounded and session-only. Packaging configuration exists but no package has been built.

## Non-goals

- Do not redesign the Toolkit UI merely because this is the portable edition.
- Do not reduce Portable to a Lite edition.
- Do not depend on MCS.OSJS.
- Do not require administrator privileges for normal portable operation unless a specific Windows/network operation inherently requires them.

## Compatibility principle

Installed and Portable are deployment/runtime variants of the same MCS Modbus Toolkit product. User-facing Modbus behavior and compatible configuration formats should remain aligned unless a platform constraint requires a documented difference.
