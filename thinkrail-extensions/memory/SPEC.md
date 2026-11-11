---
id: module-ext-memory
type: module-design
status: draft
title: ext-memory — the bundled @cloudfrog/memory adapter with its settings page
parent: module-thinkrail-extensions
depends-on: [module-thinkrail-extensions, module-extension-api]
tags: [extensions, memory]
---

## Responsibility

`thinkrail-extensions/memory/` (`@thinkrail/ext-memory`, private) bundles the third-party pi package
[`@cloudfrog/memory`](https://www.npmjs.com/package/@cloudfrog/memory) (pinned exact) into the host and
gives it a Settings page. The upstream adapter registers the `mem_*` tools, injects the Memory
instructions into `before_agent_start`, tracks sessions/prompts, recovers compacted summaries, and talks
HTTP to the **Memory server** — a separate Go binary (`memory serve`) the adapter probes on
`MEMORY_PORT` (default 6366), auto-spawns when absent and `MEMORY_URL` is unset, and self-heals around.

The extension contributes **settings only** — no web renderers: `enabled` (boolean, default on) gates the
adapter wholesale; `memoryUrl` / `memoryPort` / `memoryBin` (strings) set the adapter's `MEMORY_URL` /
`MEMORY_PORT` / `MEMORY_BIN` before its first import. The memory tools render through the default tool
card.

## Boundary

- **Owns:** the adapter wrapper (`server/adapter.ts`), the settings descriptor, the key lists and copy
  maps the panel iterates, and the declaration file for the untyped upstream package.
- **Settings apply in two tiers:** `enabled` is read per session, so later sessions see later edits. The
  three strings are read by the adapter at its **module scope**, so they bind on the adapter's first load
  in a host run and only a host restart re-reads them; the catalog passes the host's real extension
  settings, so that first load — catalog or session, whichever comes first — uses the stored values, never
  the descriptor defaults.
- **Accepted cost (upstream adapter state):** the adapter keeps its project/directory detection at module
  scope, so in the host's many-sessions-per-process model the project binds to the first session that
  initializes the adapter; later workspaces can still write anywhere through each tool's explicit
  `project` argument. Per-session module isolation was tried (query-suffixed import specifiers) and Bun
  deduplicates them into one module instance.
- **Accepted cost (server binary):** the adapter only serves requests when the Memory server runs. The
  wrapper never installs it; `memoryBin` points at the user's binary and the panel copy says so. Without
  it the tools answer "could not reach the Memory server" and the agent is told as much.
- Forbidden: importing host internals; value-importing `@cloudfrog/memory` from the `./web` half (the
  panel needs only the key lists); shipping a custom tool renderer.
