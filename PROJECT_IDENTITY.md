# Project Identity

## Project

**MCS Modbus Toolkit**

Repository: `tamzrod/MCS.ModbusToolkit`

## Purpose

Standalone desktop deployment of the MCS Modbus Toolkit.

## Current implementation

- Electron desktop application
- Windows is the current primary packaged target
- Linux desktop support may evolve independently
- macOS may be added later

## Product components

- Memory / MMA2 management
- Modbus Simulator
- Modbus Replicator
- Diagnostics

## Repository boundary

This is an independent product repository. `MCS.OSJS` is a separate OS.js/Linux deployment and is not the parent repository of this project.

The Electron implementation was initially migrated from the former `MCS.OSJS/electron` tree. Future development in this repository must not assume access to the MCS.OSJS checkout or parent-relative source paths.

Electron is the current desktop implementation technology; the product identity is **MCS Modbus Toolkit**.
