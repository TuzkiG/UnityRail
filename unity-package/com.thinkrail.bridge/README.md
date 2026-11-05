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

## Notes

- PlayMode tests can trigger a domain reload. The bridge records an interrupted run instead of claiming a
  result; use **Enter Play Mode Options** with domain reload disabled for uninterrupted PlayMode runs.
- The bridge is an Editor-only assembly. It is stripped from player builds.
