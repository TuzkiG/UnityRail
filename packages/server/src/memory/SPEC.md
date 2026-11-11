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

Probes the Basic Memory install for the settings page's engine group, opens the user's terminal to
run `uv tool install basic-memory --prerelease=allow`, and serves the **global notes manager**: the
settings page lists, previews and edits the Markdown notes under the Basic Memory folder. The module
never downloads, installs, or manages anything: Basic Memory is a public PyPI package consumed as an
MCP server (see the web MCP preset), `uvx` fetches it on demand, and the Markdown files are Basic
Memory's own source of truth.

## Boundary

- **Owns:** `probeMemoryEngine()` (PATH resolution of `basic-memory` and `uvx` through shared
  spawn), `openMemoryInstallTerminal()` (a visible, detached OS terminal window running the pinned
  command; `windowsHide: false` is the point — the window is the product), and the notes trio
  `listMemoryNotes()` / `readMemoryNote(path)` / `saveMemoryNote(path, content)` over the notes root
  (`BASIC_MEMORY_DIR`, else `~/basic-memory`): recursive Markdown scan bounded to 500 notes, reads
  and writes bounded to 1 MB, path-contained to the root, writes only over existing notes (the
  manager edits, it never creates). The status shapes are contracts' `MemoryEngineStatus` /
  `MemoryNotesSnapshot`.
- **Two scopes, one tree.** The root holds the **user-level** notes plus one folder per project
  (`memoryProjectDirName(project)` — its slug, filesystem-safe — under `projectMemoryDir(project)`). Every
  notes call takes an optional `dir`: omitted is the user scope (root, with each open project's folder
  excluded so the user list never mixes project notes in), present is that project's scope with
  `projectFolder` echoed back. A project folder is **not** registered as its own Basic Memory project:
  the engine refuses a project nested inside another, and the default `main` project already owns the
  root — which is what makes the notes reachable to the agent's MCP server by `<slug>/…` path with no
  extra registration. The `memory.*` wire methods carry `projectId` for the project scope.
- **Public surface (barrel):** the five functions above; wire methods `memory.status` /
  `memory.install` / `memory.listNotes` / `memory.readNote` / `memory.saveNote` live in
  [[submodule-server-host]] like every other request.
- Forbidden: fetching or executing Basic Memory code; importing the extension packages; touching
  the settings store; creating, deleting or renaming notes (the agent and the CLI own that).
