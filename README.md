# MCS Modbus Toolkit

Standalone desktop toolkit for Modbus simulation, replication, and memory management, powered by MMA2.

This repository is the standalone desktop deployment of the MCS Modbus Toolkit. The application currently uses Electron and is independent of the MCS.OSJS deployment repository.

## Components

- Memory / MMA2 management
- Modbus Simulator
- Modbus Replicator
- Diagnostics

## Development

```bash
npm ci
npm start
```

The repository root is the Electron application root. Runtime executables used by packaged deployments belong under `bin/`; generated installers belong under `dist/` and are not source-controlled.
