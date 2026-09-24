# Project Identity

## Project

**MCS Modbus Toolkit**

Repository: `tamzrod/MCS.ModbusToolkit`

## Purpose

Standalone product-family repository for MCS Modbus Toolkit deployments outside MCS.OSJS.

## Structure

- `desktop/` — Electron desktop implementation.
- `mobile/` — mobile-specific implementation.
- `shared/` — intentionally shared contracts and formats only.
- `docs/` — product-level documentation.

## Desktop deployment modes

The desktop implementation may produce:

- installed desktop packages
- portable desktop packages

A portable package should aim for one user-facing launch artifact with bundled MMA2, Simulator, and Replicator runtimes and no service installation requirement.

## Mobile direction

Mobile is a separate UI and runtime integration target. It may reuse product concepts and compatible contracts, but must not inherit desktop layout or Electron-specific assumptions.

## Repository boundary

`MCS.OSJS` is a separate OS.js/Linux deployment and is not the parent repository of this project.

The initial desktop implementation was migrated from the former `MCS.OSJS/electron` tree. Development here must not require an MCS.OSJS checkout.

Electron is an implementation technology for `desktop/`; it is not the product identity.
