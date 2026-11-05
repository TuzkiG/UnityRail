---
name: unity-assets
description: "Use when moving, renaming, creating or deleting Unity assets, when a scene/prefab reference breaks, or when you are tempted to edit .meta, .unity or .prefab files by hand."
---

# Unity asset safety

## The three files that matter

- **`.meta`** carries the asset's GUID. Git tracks it; Unity uses it to resolve every reference.
  Never delete, regenerate, or duplicate a `.meta` file by hand. Moving an asset without its `.meta`
  breaks every reference to it.
- **`.unity`** and **`.prefab`** are YAML documents full of `fileID` and `guid` references. Hand-editing
  is possible but fragile: a wrong `fileID` silently points at another object, a wrong `guid` at
  nothing (`Missing`).
- **`Assets/**/*.asmdef`** defines compile boundaries; see the `unity-project` skill.

## Safe operations

- Create, move, rename, and delete assets through the Editor (`AssetDatabase.MoveAsset`,
  `AssetDatabase.CreateAsset`, `EditorUtility` dialogs) or through `unity_open`/`unity_find` plus the
  Editor UI. The Editor updates GUIDs and references atomically.
- When a move is unavoidable outside Unity, move the asset and its `.meta` together, and let Unity
  reimport. Then run `unity_verify`; a missing script on a prefab is visible in the Console.
- Prefer a new asset + explicit reference swap over editing serialized YAML. If you must edit YAML,
  make one focused change and inspect the result in the Editor.
- After adding or deleting a scene, check `unity_project` (refresh) and the build settings if the
  project builds scenes by index or name.

## Missing-reference diagnosis

- `unity_inspect` shows component properties and `(none)` object references. Use it on the object that
  is actually wired wrong.
- `unity_find` with a `type` filter locates the intended asset; `unity_console` shows the runtime
  `MissingReferenceException` or `Missing` warnings.
- A component whose script shows as `Missing (Mono Script)` has a script GUID that no longer resolves.
  Find the script's current GUID in its `.meta`, confirm the asset still exists, and restore the script
  or the reference; do not blind-copy a GUID from another asset.
