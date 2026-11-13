---
id: submodule-server-memory
type: module-design
status: draft
title: server/memory — Basic Memory install, project registry and notes I/O
parent: module-server
depends-on: [module-contracts]
tags: [memory]
---

## Responsibility

Bridges the host to [Basic Memory](https://docs.basicmemory.com/integrations/pi) so the settings page
and the project Memory tab can report the install, install it, list the user's projects and
read/edit the Markdown notes. The integration is the **official Pi package**
`@basicmemory/pi-basic-memory`, installed with `bm install pi --yes` (the CLI is `bm`, from
`uv tool install basic-memory`); its transport is the `bm` CLI by default, MCP through
`pi-mcp-adapter` optionally. The module never vendors or executes Basic Memory code and never
writes Basic Memory's own config.

## Boundary

- **Owns:** the install probe, the terminal installer, the project registry reader and note I/O.
- **Install probe** (`probeMemoryEngine`): `bm` on PATH (`where`/`which` through shared spawn) plus
  its `--version` — the Pi package needs **0.24+** (`memoryCliSupported`); `uv` on PATH (the CLI
  installer); the Pi package folder `~/.pi/agent/packages/basic-memory` (honoring
  `PI_CODING_AGENT_DIR`); and the config path. Every probe runs bounded (5 s) and answers a shape,
  never throws.
- **Installer** (`openMemoryInstallTerminal(cliInstalled)`): a visible, detached OS terminal window
  (`windowsHide: false` — the window is the product, the one deliberate exception to the shared
  spawn convention) running `bm install pi --yes`, prefixed with
  `uv tool install basic-memory --prerelease=allow &&` when `bm` is missing. Both steps are
  idempotent. The host never downloads or runs anything itself.
- **Project registry** (`readMemoryProjects`): reads `<config dir>/config.json`, where the config dir
  is `BASIC_MEMORY_CONFIG_DIR` or `~/.basic-memory`; `projects` entries are `{ path, mode }` (v0.24)
  or a legacy bare path string; `default_project` names the default, and an unset default is **the
  first configured project** (the documented rule). Before the file exists the reader synthesizes
  the documented default project `main` → `~/basic-memory`, so the UI works before `bm` first runs.
  Invalid JSON degrades to that same default rather than failing the page.
- **Notes** (`listMemoryNotes` / `readMemoryNote` / `saveMemoryNote`, keyed by **project name**):
  paths are relative to that project's folder, containment-checked, `.md` only, 1 MB per read/write,
  500 notes per listing, hidden entries skipped and newest first. Writes only overwrite existing
  notes — the agent and the CLI create them. Unknown project names throw
  `MEMORY_PROJECT_NOT_FOUND`.
- **Pi config** (`readMemoryPiConfig` / `saveMemoryPiConfig`, `<project>/.pi/basic-memory.json`): the file the Basic Memory Pi package itself reads. Reads default to what the package uses (`transport: cli`, `captureFolder: pi/sessions`, `autoRecall`/`autoCapture` on); writes are a **merge** that keeps every key this module does not own (`useHookFlow`, `captureMinChars`, …), validates `transport`/`captureFolder`/booleans with `MEMORY_PI_CONFIG_INVALID`, and normalizes the capture folder to a relative POSIX path. Unknown project ids throw `PROJECT_NOT_FOUND`. The host never creates the `.pi` folder elsewhere and never touches the global Basic Memory config.
- **Public surface (barrel):** `probeMemoryEngine`, `memoryCliSupported`, `MEMORY_MIN_CLI_MINOR`,
  `openMemoryInstallTerminal`, `memoryInstallCommand`, the two install-command constants,
  `readMemoryProjects`, `requireMemoryProject`, `listMemoryNotes`, `readMemoryNote`,
  `saveMemoryNote`, `memoryNoteDir`, `memoryConfigDir`, `memoryConfigPath`, `memoryPiConfigPath`,
  `readMemoryPiConfig`, `saveMemoryPiConfig`; wire methods
  `memory.status` / `memory.install` / `memory.projects` / `memory.revealProject` /
  `memory.piConfig` / `memory.savePiConfig` / `memory.listNotes` / `memory.readNote` /
  `memory.saveNote` live in [[submodule-server-host]] like every other request.
- Forbidden: fetching, vendoring or executing Basic Memory code; importing the extension packages;
  writing `config.json`, registering projects or creating notes (the CLI, `bm project add`, and the
  agent own that); touching the settings store.
