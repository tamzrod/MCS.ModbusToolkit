# Portable desktop edition — development foundation

This is an independent Electron application root, based on the installed UI and
product logic at commit `0e3d9a6`. It does not import the installed edition at
runtime. Corresponding product fixes should be reviewed for both editions until
shared contracts/modules are deliberately extracted.

```powershell
cd desktop/portable
npm ci
npm test
npm start
```

`npm run dist:win` targets a single portable Windows executable.
`npm run pack:win` targets an unpacked application directory. Both require the
three backend executables documented in `bin/README.md`.

Configuration and the Electron profile live in `data/` next to the portable EXE
(or under this directory in development). The folder must be writable. For the
self-extracting distribution, `PORTABLE_EXECUTABLE_DIR` selects the original EXE
directory instead of the temporary extraction directory. Existing config is
preserved. Isolated UI review supports `MCS_REVIEW_DATA_ROOT` and starts no backend.

The app uses Electron's single-instance lock for its data/profile folder and
tracks only child handles it created. Start checks for all three payloads; status
distinguishes missing files, spawn failures and unexpected exits. Closing waits
for children to exit, stopping Replicator and Simulator before MMA2. Logs retain
the latest 200 chunks (at most 8192 characters per chunk) in memory for diagnostics.
No service installation or service control is used.

## Remaining release blockers

- Complete backend compatibility testing beyond empty-config startup and Replicator load.
- Add a cooperative Windows shutdown protocol. Node's `child.kill` terminates
  Windows processes; current shutdown is **not graceful** and is unsuitable for
  claiming backend state has been flushed.
- Add cross-copy port conflict protection and readiness checks. The profile lock
  covers the same data folder, not different portable folders or installed services.
- Validate whether Simulator random publishing belongs in the backend or UI to
  avoid duplicate writers when the real backend is supplied.
- Persist bounded logs if logs need to survive application closure.
- Verify functionality and clean-machine packaging with actual runtimes.

## Local build verification (2026-10-01)

Copied the three backend executables from `D:\2026\Go Programming\MCS.OSJS\electron\bin`
and built `dist/MCS-Modbus-Toolkit-0.1.0-Portable.exe` (unsigned Windows x64).
All 42 unit tests passed. An isolated empty-config test started all three real
backends, loaded Replicator over IPC, and stopped all owned child processes.
The packaged renderer loaded in isolated review mode. Live Modbus behavior and
clean-machine deployment have not been verified.

Launch supplies both `MCS_DATA_ROOT` and the imported runtimes' `OSJS_DATA_DIR`.
MMA2 requires an explicit config filename. The imported Windows runtimes use
fixed pipe names, so installed and portable instances cannot yet run concurrently.

Process status indicates process lifecycle only, not backend readiness or valid
Modbus communication. This foundation is not a release-ready portable package.

## Portable 0.1.1 restart acknowledgement

Electron now watches MMA2 restart requests, stops and restarts only its owned
MMA2 child, waits for the requested ports and confirms the configuration hash
before writing the acknowledgement. Replicator stays running throughout its
Save & Apply transaction. Shutdown cancels pending acknowledgements and drains
the restart operation before stopping the stack.

Regression checks cover failed readiness, stale config, repeated requests and
shutdown races. `node build/runtime-smoke.cjs` additionally tests two real
Replicator applies and reads the replicated value through Modbus. It refuses
to run while another Toolkit owns the fixed backend pipe names.

0.1.1 validation: 50 unit tests and isolated Electron startup passed. The real
MMA2-only regression (`node build/mma2-restart-smoke.cjs`) restarted twice,
verified matching acknowledgements and read FC3 memory after reload. The full
Replicator apply regression remains pending while the existing Toolkit owns
the shared pipe names. The 0.1.1 Windows portable executable built successfully.
