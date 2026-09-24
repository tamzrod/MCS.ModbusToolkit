# Windows payload binaries

Place the Windows executables in this folder before running `npm run dist:win`:

```text
nssm.exe
mma2.exe
modbus-simulator-runtime.exe
modbus-replicator-runtime.exe
```

These files are copied into the installed application's `resources/bin` directory by electron-builder.

`nssm.exe` is used only by the elevated installer/uninstaller to register, configure, start, stop, and remove the backend Windows services.
