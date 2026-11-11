---
id: submodule-server-memory
type: module-design
status: draft
title: server/memory — basic-memory engine probe and terminal install
parent: module-server
depends-on: [module-contracts]
tags: [memory]
---

## Responsibility

Probes the Basic Memory install for the settings page's engine group and opens the user's terminal
to run `uv tool install basic-memory --prerelease=allow`. The module never downloads, installs, or
manages anything: Basic Memory is a public PyPI package consumed as an MCP server (see the web
MCP preset), and `uvx` fetches it on demand; this module only reports what the preset and the
installer would find.

## Boundary

- **Owns:** `probeMemoryEngine()` (PATH resolution of `basic-memory` and `uvx` through shared
  spawn) and `openMemoryInstallTerminal()` (a visible, detached OS terminal window running the
  pinned command; `windowsHide: false` is the point — the window is the product). The status shape
  is contracts' `MemoryEngineStatus`.
- **Public surface (barrel):** the two functions above; wire methods `memory.status` /
  `memory.install` live in [[submodule-server-host]] like every other request.
- Forbidden: fetching or executing Basic Memory code; importing the extension packages; touching
  the settings store.
