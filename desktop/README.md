# Desktop Editions

MCS Modbus Toolkit has two Windows desktop deployment variants.

## Installed

`installed/` is the current installed implementation. Its backend runtimes are managed as Windows services, with NSSM used by the elevated installer/uninstaller.

Runtime model:

```text
Electron UI
└── Windows services
    ├── MCS-MMA2
    ├── MCS-Simulator
    └── MCS-Replicator
```

## Portable

`portable/` is the service-free desktop variant under development. It will bundle and manage MMA2, Simulator, and Replicator as child processes owned by the Electron application.

See `portable/TODO.md`.
