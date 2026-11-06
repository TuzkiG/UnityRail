---
name: unity-project
description: "Use when starting work in a Unity project, when you need the project's version, packages, assembly definitions, scenes or prefabs, or before changing C# so you know which assembly and references the code belongs to."
---

# Unity project orientation

## Read the project first

- `unity_project` returns the editor version, product name, packages, assembly definitions (with their
  references), scenes, prefabs, script/asset counts, and whether the Unity bridge is running.
- Re-read it with `refresh: true` after adding a package, an assembly definition, or a scene you created
  outside the Editor.
- If `unity_doctor` reports `NOT_UNITY_PROJECT`, the workspace is not a Unity project root. Ask which
  folder to open; do not create `ProjectSettings` or guess.

## Assembly definitions are the compile boundary

- An `asmdef` owns the scripts in its folder and below until another `asmdef` appears. A script that
  uses a type from another assembly needs a reference in its own `asmdef`.
- Editor-only code belongs in an Editor `asmdef` (`includePlatforms: ["Editor"]`) or an `Editor/`
  folder under an assembly that already excludes players.
- `GUID:` references point at another `asmdef`'s `.meta` GUID. Prefer the assembly name unless the
  project already uses GUID references; renaming an assembly breaks name references.
- Never add a reference from runtime code to Editor-only assemblies. It compiles in the Editor and
  fails in a player build.
- After changing an `asmdef`, run `unity_compile`; then use the diagnostic's assembly name to find the
  offending definition.

## Packages and Unity version

- `Packages/manifest.json` is the requested package set; `Packages/packages-lock.json` is the resolved
  set. Both are project files; change them deliberately, not to work around a missing API.
- The Unity version in `ProjectSettings/ProjectVersion.txt` is the compiler and API contract. Do not
  use APIs newer than that version without checking the package or a version define.

## The project's own Editor tools

- Some projects register their own Editor tools in C# (`[BridgeTool]`). They arrive as a `unity-editor-tools`
  section of your context, and `unity_editor_tool` with no `name` lists them with their parameter docs.
- Use them before writing a new editor script: a project that already ships a folder generator, importer,
  validator or bake step expects that one to run. Call one as
  `unity_editor_tool { name, parameters }` and read its JSON result; a tool that throws comes back as an
  error with the C# message, which is the real failure, not a transport problem.
- After a tool changes the project, run `unity_compile` (and `unity_console`) before claiming it worked.

## Scenes and prefabs

- `unity_hierarchy` reads the open scene; `unity_find` finds scene and prefab assets by name/type.
- `.unity` and `.prefab` files are serialized YAML with GUID references. Prefer Editor APIs (through
  `unity_open`, `unity_select`, `unity_inspect`) over hand-editing them.
- When you must edit serialized YAML, preserve the header, `fileID` identities, and `.meta` files. A
  missing or duplicated GUID silently breaks references.
