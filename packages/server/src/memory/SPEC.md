---
id: submodule-server-memory
type: module-design
status: draft
title: server/memory — Memory engine status and terminal install
parent: module-server
depends-on: [module-contracts, submodule-server-settings]
tags: [memory]
---

## Responsibility

Probes the Memory engine for the settings page's engine group and opens the user's terminal to run
the official `pi install npm:@cloudfrog/memory` install command. The module never downloads,
installs, or manages the engine binary: the bundled adapter ([[module-ext-memory]]) already
auto-starts `memory serve` and self-heals; this module only reports what the adapter will find.

## Boundary

- **Owns:** `probeMemoryEngine()` (binary resolution from the `memory` extension's `memoryBin`
  setting against `PATH` when the name is bare, plus the `/health` probe against `memoryUrl` or
  the local `memoryPort`) and `openMemoryInstallTerminal()` (a visible, detached OS terminal
  window running the pinned command; `windowsHide: false` is the point — the window is the
  product). The status shape is contracts' `MemoryEngineStatus`.
- **Public surface (barrel):** the two functions above; wire methods `memory.status` /
  `memory.install` live in [[submodule-server-host]] like every other request.
- Forbidden: fetching or executing binaries; importing the extension packages; touching the
  settings store directly (reads go through the settings barrel's `getConfig()`).
