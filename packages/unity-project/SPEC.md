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
  versioned shape (`UNITY_BRIDGE_PROTOCOL_VERSION = 2`), default port `39217`, discovery file
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

## Writing to the Editor (protocol v2)

The bridge is not read-only. `POST /v1/scene/object`, `DELETE /v1/scene/object`, `POST`/`DELETE
/v1/component`, `PATCH /v1/property`, `POST /v1/scene/save` and `POST /v1/undo` are the structural write
path: they run on the Editor's main thread, resolve objects by hierarchy path (the open prefab stage
root counts as `""` or its name), resolve component types by name across loaded assemblies, and set
serialized properties for int/bool/float/string/enum/color/vector2-4/object-reference/array-size/
layer-mask. **Every change is one Undo step** (`Undo.RegisterCreatedObjectUndo`, `Undo.AddComponent`,
`Undo.DestroyObjectImmediate`, `Undo.RecordObject`); a scene or prefab stage is saved only when the
caller passes `save: true`, and `save`/`undo` have their own endpoints. A real project directory is never
touched by the write path — only the open scene/prefab stage.

Global control is separate and explicit: `POST /v1/menu` runs an Editor menu item (refused while
compiling/importing), `POST /v1/build` + `GET /v1/build/status?id=` drive `BuildPipeline.BuildPlayer`
into a project-contained output and report size/duration/errors, `GET`/`POST /v1/packages` use the
Package Manager client (an add/remove may reload the domain before answering; callers treat a dropped
connection as accepted), `GET`/`POST /v1/settings` read/write an allowlisted PlayerSettings subset,
`GET /v1/profiler` reports the render/memory markers this Unity version exposes, `POST /v1/input` queues
a keyboard state through the Input System **by reflection** (the bridge assembly has no package
reference, so a project without Input System gets a clear 409), and `POST /v1/editor/quit` refuses while
Play Mode runs or a scene is dirty unless `save`/`discard` says otherwise.

`UNITY_BRIDGE_PROTOCOL_VERSION` is **2**: an older Editor package is refused rather than parsed
optimistically. Confirmation is a product-level rule, not a bridge one: the server/tool layer requires
`confirm: true` for destructive or global actions (delete/remove component, menu, build, package change,
settings write, quit); the bridge itself executes what an authenticated caller asks for, so a hand-written
HTTP client keeps full control.

## Asset semantics (`src/semantics/`)

`parseUnityYaml` reads Unity's multi-document asset YAML read-only and returns one record per object
(`classId`, `fileId`, root type, line, flattened scalar/reference fields). It parses as YAML **1.2
failsafe**: Unity declares 1.1, where `y`/`n`/`on` are booleans (a field named
`m_LocalPosition.y` must stay a key), and every scalar must stay a string, because a 64-bit fileID
must never pass through a JS number. Bounds: 4,000 documents, 2,000 fields per document, 160-character
values, depth 12; `truncated` says a cap was hit.

`buildUnityObjectModel` resolves GameObject names, transform paths (through `m_Father`), MonoBehaviour
scripts and asset references through an injected GUID resolver, so it owns no project cache. FileID
references stay raw (`fileID 100`): resolving them to names would make a rename ripple into every
component's `m_GameObject` and every parent's `m_Children`, hiding the one field that changed.
`diffUnityObjectModels` matches objects by fileID and returns added/removed objects plus per-field
before/after changes, each object carrying the line its document starts at (the review anchor). Caps:
200 objects per side and 60 field changes per object, with `truncated`.

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
