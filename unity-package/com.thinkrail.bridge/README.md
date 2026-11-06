# UnityRail Unity Bridge

This package lets the UnityRail AI IDE Observe and drive the Unity Editor.

## Install

Add the package to a Unity project's `Packages/manifest.json`:

```json
{
  "dependencies": {
    "com.thinkrail.bridge": "file:../../path/to/thinkrail/unity-package/com.thinkrail.bridge"
  }
}
```

Or copy `com.thinkrail.bridge` under `Packages/`.

## Use

1. Open the project in Unity.
2. Choose **Tools > UnityRail > Start Bridge** (the bridge starts automatically by default).
3. Open the same project in UnityRail. The Unity panel connects on its own.

The bridge listens on `127.0.0.1` only, requires a per-session bearer token, and writes its endpoint to
`Library/ThinkRailBridge.json` plus `~/.thinkrail/unity/bridges.json`. It never opens a port on another
interface.

## Extend it from your own project code

A static method in an Editor assembly can become an Editor tool the agent can call:

```csharp
using Newtonsoft.Json.Linq;
using UnityRail.Bridge;

public static class MyTools
{
    [BridgeTool("create_folder", "Create a folder under the project.", "path: project-relative folder")]
    public static object CreateFolder(JObject parameters)
    {
        string path = (string)parameters["path"];
        AssetDatabase.CreateFolder("Assets", path);
        return new { ok = true, path = "Assets/" + path };
    }
}
```

The method must be `public static`, take one `JObject` and return a JSON-serializable value. Assemblies
with an asmdef need a reference to `ThinkRail.Bridge.Editor`; `Assembly-CSharp-Editor` needs nothing.
Tools are discovered on every call (no reload needed after a script change compiles), listed by
`GET /v1/tools` and called through `POST /v1/tools` with `{ name, parameters }`. The agent sees both the
list and the call as one `unity_editor_tool` — it lists them with no name and runs one with a name.

## What the agent can do

- Read compile diagnostics and wait for a recompile (including across Unity's domain reload). A forced
  compile (`force: true`) requests a clean compilation on Unity 6 and falls back to a plain request on
  2022.3, which has no clean-compilation API.
- Read and clear the Console with sequence-based pagination.
- Enter, pause, resume, step and stop Play Mode.
- Capture the Game View or Scene View as a PNG.
- Run EditMode and PlayMode tests through the Unity Test Framework.
- Read the active scene hierarchy, inspect a GameObject's components/properties, search assets, open an
  asset or scene, and change the Editor selection.

- Edit the open scene or prefab stage: create/delete a GameObject, add/remove a component, and set a
  serialized property (scalars, enums, vectors, colors, object references). Every change is one Undo
  step; saving happens only when the caller asks for it (save: true), and the caller can undo.
  `create` and `addComponent` accept `ensure: true` when the caller may be retrying: the object at
  `parent/name` is reused (`created: false`) and an already-attached component is returned
  (`added: false`) instead of duplicating either.
- Run an Editor menu item (Assets/Refresh, a build menu, a project tool).
- Build a player for a supported target and poll the build report (size, duration, errors).
- List, add and remove packages through the Package Manager client.
- Read and write an allowlisted subset of PlayerSettings (product/company name, version, application
  identifier, default screen size, fullscreen mode, run in background, resizable window).
- Take a profiler snapshot of the common render/memory markers.
- Synthesize keyboard input while Play Mode runs (through the Input System package when installed).
- Quit the Editor, refusing while Play Mode runs or a scene has unsaved changes unless the caller
  explicitly saves or discards.

Every write requires the caller to say what it wants (confirm: true for destructive or global actions:
delete/remove component, menu, build, package change, settings write, quit). The bridge also refuses
while Unity is compiling or importing, and a package change may reload the domain before answering —
callers treat a dropped connection as "accepted" and re-read state.
## Notes

- PlayMode tests can trigger a domain reload. The bridge records an interrupted run instead of claiming a
  result; use **Enter Play Mode Options** with domain reload disabled for uninterrupted PlayMode runs.
- The bridge is an Editor-only assembly. It is stripped from player builds.
