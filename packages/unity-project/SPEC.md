---
id: module-unity-project
type: module-design
status: active
title: unity-project — the Unity project model and Editor bridge client
parent: architecture
depends-on: []
tags: [unity]
---

## Responsibility

The Node-only knowledge of a Unity project and of the UnityRail Editor bridge. Two halves:

- **Project model** (`src/project/`): find the project root, read the editor version, product/company
  identity, packages, `.asmdef` graph, scenes, prefabs and asset counts; index asset GUIDs from `.meta`
  files and resolve references in both directions; list the repositories a project composes
  (`parseGitmodules`, `detectUnityModules`) and the directory links it mounts (`listDirectoryLinks`). Reads are bounded and deterministic: a 60,000-file /
  24-level walk, 8 MiB text reads, and no symlink following, so a linked folder can never turn a project
  read into an unbounded filesystem scan. A missing project root is a `UnityProjectError`
  (`NOT_UNITY_PROJECT`).
- **Editor bridge client** (`src/bridge/`): discover a running Editor, speak its HTTP protocol, and wait
  out compile, test and Play Mode transitions.

`doctor.ts` composes both into a non-throwing diagnosis (`diagnoseUnityWorkspace`), and `launch.ts` opens
the matching installed Editor (`findUnityInstall`, `openUnityProject`).

## Boundary

- **Owns:** `UnityProjectInfo` and the project caches; `findUnityProjectRoot`, `readUnityProject`,
  `findUnityInstall`, `openUnityProject`, `diagnoseUnityWorkspace`; the bridge discovery types and client
  (`UnityBridgeClient`, `connectUnityBridge`, `withUnityBridge`); the bridge protocol shape.
- **Protocol:** `src/bridge/protocol.ts` is the contract with `unity-package/com.thinkrail.bridge` — one
  versioned shape (`UNITY_BRIDGE_PROTOCOL_VERSION = 1`), default port `39217`, discovery file
  `Library/ThinkRailBridge.json`, registry `~/.thinkrail/unity/bridges.json`. The Unity side implements
  it with Newtonsoft.Json; this side treats every field as untrusted and normalizes it (discovery is
  parsed strictly; status, Console pages, hierarchy snapshots and test-run records go through
  `normalize*` passes that fill defaults and refuse a wrong protocol version).
- **Mounts:** `createDirectoryLink` / `removeDirectoryLink` / `moduleMountPath` are the only writes this
  package performs, and they only ever touch a directory link under the project's `Assets/`. An external
  folder is mounted, never copied or modified, and removing a link never deletes its target. Node sees a
  Windows junction and a directory symlink identically, so both report as `junction` on Windows and
  `symlink` elsewhere.
- **Allowed deps:** Node `fs`/`path`/`os`/`child_process`/`http`; no workspace package at all (the
  bridge wire types are re-exported from here and mirrored, not imported, by `packages/contracts`).
- **Forbidden:** the workspace store, session/agent state, `@earendil-works/pi-coding-agent`, and the UI.
  Nothing here may import another UnityRail package or reach the network beyond `127.0.0.1`.

## Security constraints

- **Loopback only.** The client's base URL is always `http://127.0.0.1:<discovery port>`.
- **Token.** Discovery must carry a token of at least 16 characters, a port in `1024–65535`, a PID and a
  project path; anything else parses as absent. Every request sends the token as a bearer header.
- **Path containment.** A workspace reaches a project only through `findUnityProjectRoot`; project
  content walks stay inside `Assets/` (and `Packages/` when asked), skipping Unity-generated folder
  names (`Library`, `Temp`, `Logs`, `obj`, `Build`, ...) only at the content root — a user folder with
  one of those names deeper inside `Assets/` is walked — and `.git`/`.idea`/`.vs` everywhere. A bridge whose discovery `projectPath` is not the workspace's project (compared
  case-insensitively on Windows, `canonicalProjectPath`/`sameProjectPath`) is refused as
  `BRIDGE_PROJECT_MISMATCH` rather than answered.
- **PID liveness.** A discovery file is trusted only while its PID is alive; otherwise the global
  registry's matching entry is tried, so a stale `Library` file from a crashed Editor cannot route
  requests to a reused port.
- **Protocol version.** A bridge speaking another version is refused as `BRIDGE_PROTOCOL_MISMATCH`
  instead of being parsed optimistically.

## Discovery and reconnection

`readUnityBridgeDiscovery(projectRoot, home)` prefers the project's `Library/ThinkRailBridge.json` and
falls back to the registry entry whose project matches, both filtered by PID liveness. Discovery is
re-read on every connection: there is no cached client. `withUnityBridge(projectRoot, operation, options)`
re-discovers and retries an operation **once** after `BRIDGE_UNAVAILABLE` only when the caller sets
`retryUnavailable: true` — reads do; writes never retry, because replaying a non-idempotent action after
an ambiguous failure can double it. Compile and test polling reconnect **in place**: when the poll hits a
bridge error it re-reads the discovery file and swaps port/token if the Editor restarted (a domain reload
changes both), then keeps polling; a bridge error with no discovery change is tolerated twice and thrown
on the third. The Editor is the only structural truth: hierarchy, inspection, play mode and screenshots are
read from the live Editor, never from a host-side mirror.

## Reading the project

`readUnityProject` returns the editor version (`ProjectVersion.txt`), product/company identity,
`Packages/manifest.json` + lock versions (builtin marked), the `.asmdef` graph with resolved and missing
references and cycles, scenes/prefabs, counts, bridge discovery and human-readable warnings. `refresh`
clears the GUID/asset caches (`clearUnityProjectCaches`). `findUnityInstall` checks
`THINKRAIL_UNITY_EDITOR` / `UNITY_EDITOR_PATH`, then the Unity Hub install roots per platform.

## Diagnosis

`diagnoseUnityWorkspace` never throws and returns `UnityDoctorResult`: whether the workspace is a Unity
project, its root/version/product, install and bridge state, and findings with `severity` + `code`
(`NOT_UNITY_PROJECT`, `NO_SCENES`, `ASMDEF_CYCLE`, `ASMDEF_MISSING_REFERENCE`, `PROJECT_READ_FAILED`,
`PROJECT_WARNING`, `UNITY_INSTALL_NOT_FOUND`, `BRIDGE_NOT_RUNNING`, `BRIDGE_PROJECT_MISMATCH`,
`BRIDGE_PROTOCOL_MISMATCH`, `UNITY_COMPILING`, `COMPILE_FAILED`). The agent tool and the Unity panel
render the same report.

## Consumers

`thinkrail-extensions/unity` (agent tools), `packages/server/src/unity` (the `unity.*` wire methods), and
through it `apps/web`'s Unity panel. Detail for the extension half: [[module-ext-unity]]; the host
service: [[submodule-server-unity]].
