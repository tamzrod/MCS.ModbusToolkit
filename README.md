# MCS Modbus Toolkit

MCS Modbus Toolkit is the standalone Toolkit product family for Modbus simulation, replication, and memory management, powered by MMA2.

## Repository layout

```text
MCS.ModbusToolkit/
├── desktop/   # Electron desktop implementation
├── mobile/    # Android/mobile implementation
├── shared/    # Cross-target contracts and shared formats
├── docs/      # Product-level documentation
├── LICENSE
├── PROJECT_IDENTITY.md
└── handoff.md
```

### Desktop

The current working implementation lives in `desktop/`. Windows is the primary packaged target. Installed and portable distributions can be produced from the same desktop implementation.

### Mobile

`mobile/` is reserved for the mobile-specific Toolkit implementation. It should use a mobile UI and mobile lifecycle rather than attempting to run the Electron desktop UI.

### Shared

`shared/` is reserved for contracts or formats that genuinely need to stay identical across deployment targets. Do not move code here merely to remove duplication.

## Desktop development

```bash
cd desktop
npm ci
npm start
```

`MCS.OSJS` remains a separate OS.js/Linux deployment repository.
