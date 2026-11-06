---
id: module-ext-unity
type: module-design
status: active
title: Unity extension
parent: module-thinkrail-extensions
depends-on: [module-unity-project, module-pi-unity-skills, module-extension-api, module-contracts, module-locales, module-ui]
references: [submodule-server-unity, submodule-server-extensions, submodule-web-extensions, web-color, web-spacing, web-typography]
---

## Responsibility

The UnityRail halves of the Unity capability. `./server` gives the agent 19 `unity_*` tools over
[[module-unity-project]]; `./web` renders each tool call as a card. The tool name joins the halves with no
wire change. The extension is a normal [[module-thinkrail-extensions]] entry named `unity`, switchable in
Settings → Extensions; it has no child extensions.

## Boundary

- **Server:** `@thinkrail/ext-unity/server` default-exports
  `defineServerExtension({ name: "unity", title: "Unity", description, extensions: [registerUnityExtension], skillPackages: ["@thinkrail/pi-unity-skills"] })`.
  No session factories, interactive tools or child extensions. It may import
  `@thinkrail/extension-api/server` (the `defineServerExtension` helper), `@thinkrail/unity-project` (the
  model, bridge client and doctor), `typebox` for the parameter schemas, and
  `@earendil-works/pi-coding-agent` — types only in production code, the package's `ExtensionAPI` type.
- **Web:** `@thinkrail/ext-unity/web` default-exports a `defineWebExtension` whose `toolRenderers` map all
  19 names to `UnityToolCard`, with per-tool summaries. It may import `@thinkrail/contracts` (the wire
  detail types), `@thinkrail/locales` + `@thinkrail/locales/react` (`unity.*` keys), `@thinkrail/ui/utils`
  (`cn`), `@thinkrail/extension-api/web` (`ToolRenderProps`, `resultText`, `strArg`), and
  `@remixicon/react`; it does not import the server half, the host, or any pi package at runtime.
- **Forbidden:** importing `packages/server` or `packages/shared`, creating host state, teaching the
  `apps/web` shell a Unity-specific tool name (the renderer registry joins by name), or caching Editor
  state on either side.

## Server tools

**Project** (`project.ts`): `unity_project` reads the project model (version, packages, asmdef graph,
scenes, prefabs, counts, bridge state; `refresh: true` clears the caches); `unity_doctor` returns the
non-throwing diagnosis and sets `isError` when any finding is an error; `unity_open_editor` launches the
matching installed Editor, or reports that one is already running for this project.

**Bridge** (`bridge.ts`): `unity_compile` waits through domain reload and returns diagnostics;
`unity_console` reads since a sequence, filters by level, or clears; `unity_playmode` drives
play/stop/pause/resume/step; `unity_tests` runs EditMode/PlayMode tests; `unity_screenshot` captures the
Game or Scene View.

**Scene** (`scene.ts`): `unity_status` reads Play Mode/compile/scene/selection; `unity_hierarchy` reads the
open scene (or a named scene or the open prefab stage) with paths and component types;
`unity_inspect` reads one GameObject's components and serialized properties by hierarchy path;
`unity_find` searches assets; `unity_open` and `unity_select` hand a project path to the Editor.

**Scene writes** (`bridge.ts`, protocol v2): `unity_edit_scene` edits the open scene or prefab stage —
action `create` (name/parent/components), `delete`, `addComponent`, `removeComponent`, `setProperty`
(hierarchy path + component + serialized property + value), `save` and `undo`. `delete` and
`removeComponent` require `confirm: true`; the tool refuses otherwise and tells the agent to ask the user.
Updates are Undo-backed and saved only when the call says `save: true`. `create` and `addComponent` take
`ensure: true` for a write the agent may be retrying: the bridge reuses the GameObject at `parent/name`
and an already-attached component, and reports `created: false` / `added: false`, so a redelivered call
returns the same end state instead of a duplicate. The tool never retries a write itself —
`withUnityBridge` only retries reads — so the flag is the caller's, not a hidden replay.

**Project code** (`tools.ts`): `unity_editor_tool` reaches the `[BridgeTool]` methods the project
registers in its own C# — with no `name` it lists them (`GET /v1/tools`), with a `name` it runs one
(`POST /v1/tools`) and returns the tool's JSON result. It is one meta-tool on purpose: a project's tools
are discovered at runtime, so registering each as a pi tool would need the Editor to be up when the
session starts. The tool has no `confirm` gate of its own — the bridge executes what its authenticated
caller asks, and the project's C# decides what its tool does. `unity_editor_tool` details are
`{ mode: "list", tools }` or `{ mode: "invoke", name, result }`.

**Project control** (`bridge.ts`, protocol v2): `unity_project_action` runs `menu`, starts and polls a
`build`, lists/adds/removes `packages`, reads/writes allowlisted PlayerSettings, takes a `profiler`
snapshot, queues keyboard `input` during Play Mode, and `quit`s the Editor. `menu`, `build`, package
changes, settings writes and `quit` require `confirm: true`.

Every tool resolves the project root from `ctx.cwd` (walking up to `ProjectSettings/ProjectVersion.txt`),
connects through `withUnityBridge` — reads pass `retryUnavailable` for the one rediscovery retry after a
domain reload; writes never retry; `unity_compile`/`unity_tests` stay connected through in-place
rediscovery while polling — and returns a text summary plus the payload in `details` so both the model
and the card can use it. `unity_project` details project the bridge discovery: the bearer token never
enters a transcript. `MAX_TOOL_TEXT` (48,000 chars) truncates text only, never details.

### Result semantics

- **`details` are the payload.** Cards read the same `details` object the tool returned
  (`UnityCompileStatus`, `UnityConsolePage`, `UnityTestRunStatus`, `UnityHierarchySnapshot`,
  `UnityGameObjectInspection`, `UnityAssetResult[]`, `UnityProjectInfo`, doctor report, bridge status).
- **`isError` means the agent must correct or retry**: a thrown `UnityBridgeError`/`UnityProjectError`
  (formatted `[CODE] message`), a failed compile, a test run whose state is `error`, a doctor report with
  an error finding, or a `unity_verify` run that could not compile/play. A test run that executed and
  reported failed tests is a normal result (state `failed`), not an `isError`.
- **Images are content blocks.** `unity_screenshot` returns one text caption plus one
  `{ type: "image", data, mimeType }` block; `details` omits `base64`. `unity_verify` appends the same
  image block when it captured one.
- **`unity_verify` is the loop in one call**: compile (any failure stops there with `isError`); optional
  Edit/PlayMode tests (`testMode`); unless `play: false`, read the Console's `nextSeq` as a baseline,
  enter Play Mode, wait `playSeconds` (default 5, clamped 1–30), read only Console entries since the
  baseline, capture a Game View frame unless `screenshot: false`, and stops Play Mode in `finally`
  once play started — a stop failure is reported as text, not hidden. The result is
  `details: { compile, tests, console,
  screenshot }`; it is `isError` when Play Mode verification itself failed.
- **Sizes are clamped at the tool edge**: screenshot width 64–1600, hierarchy display depth 1–32 and 400
  objects, asset limit 30 default/100 max, console/tests lists bounded in the text summary.

## Skills

`skillPackages: ["@thinkrail/pi-unity-skills"]` makes the host stage the five Unity skills with the
extension's tools, so switching `unity` off drops its skills too. See [[module-pi-unity-skills]].

## Editor selection context

`context.ts` registers one `before_agent_start` hook that adds two system-prompt sections and never blocks
a turn: when the workspace is inside a Unity project and its bridge answers within 2 s, the Editor's
selection (up to five entries that have a path, with hierarchy path and active scene for GameObjects) is
written into the `unity-editor-selection` section, and the project's own `[BridgeTool]` tools (name plus a
one-line description, capped at 12, with a pointer to `unity_editor_tool` for the full list) into
`unity-editor-tools`. No selection, no tools, a closed Editor, a busy domain reload or any bridge failure
instead removes that section and never throws — an optional Editor must not block a turn, and a stale tool
list is worse than none because the agent would call a name the Editor no longer has. The selection section
is injected context, not a chat message: the web composer's chip shows the same selection, while message
text, titles and reconciliation stay the user's own words. Only status and the tool list are read; the hook
caches nothing and writes no state.

## Rendering contract (web)

`UnityToolCard` is props-driven: it never reads the store or the transport. It renders the tool's
`details` by shape — compile diagnostics, Console rows, test results, a recursive hierarchy tree (capped
at 60 nodes / depth 12), and asset search rows; `unity_verify` composes the compile/test/console bodies.
Project, doctor, status, playmode and open-editor calls render their structured text result. Anything
without recognized details falls back to the plain result text (running, error, or an older/streaming
call). A running call shows a
spinner; an error shows the failure text. Screenshots rely on the chat's standard image block, and the
card shows the view/size summary. `unity_verify` is primary and expanded by default; `unity_doctor` is
primary. Summaries unwrap the tool result's `details` before reading counts/scene/version/path, and fall back to
the tool's stable `unity.tool.*` label. PlayMode actions and screenshot views map through `unity.*` keys
too — no raw protocol tokens in card summaries. All layout uses the semantic tokens and
canonical spacing from [[web-color]], [[web-spacing]] and [[web-typography]]; no raw colors or text.

## UI translations

Every visible string is a `unity.*` key in `packages/locales/en.json`. Nothing in either half composes
user-facing prose for the UI; the agent-facing tool descriptions and text results stay English, like all
agent and tool output.
