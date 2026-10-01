# Portable backend payload

Supply matching Windows builds of:

- `mma2.exe`
- `modbus-simulator-runtime.exe`
- `modbus-replicator-runtime.exe`

No backend binaries or backend source are currently included in this repository.
Packaging checks for these files and fails when any are missing. Only these three
executables are copied into the portable payload; NSSM is not used.

Backend compatibility, configuration reload and cooperative Windows shutdown
must be verified before distributing this edition.
