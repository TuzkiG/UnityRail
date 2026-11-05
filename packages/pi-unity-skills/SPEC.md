---
id: module-pi-unity-skills
type: module-design
status: active
title: pi-unity-skills — Unity development skills
parent: architecture
depends-on: []
references: [module-ext-unity, module-unity-project]
tags: [pi-package, skills, unity]
---

## Responsibility

A skills-only package (`@thinkrail/pi-unity-skills`) that teaches the agent how to work in a Unity
project without guessing: read the project and its compile boundaries first, verify through the Editor
rather than from source alone, write gameplay code that respects Unity's lifecycle and serialization,
prove behavior with the Test Framework, and treat GUID-bearing assets as Editor-owned. It contains no
tools, no extension factories and no runtime dependency; its `pi.skills` manifest points at
`./skills`, and its only consumer is `skillPackages` on [[module-ext-unity]].

## The skills

- **`unity-project`** — orientation. Use the `unity_project` model (version, packages, asmdef graph,
  scenes) before changing C#; assemble references and Editor-only boundaries from the `.asmdef` graph;
  ask which folder to open when the workspace is not a project rather than inventing `ProjectSettings`.
- **`unity-verify`** — the verification loop. Compile and read every diagnostic, take a Console baseline,
  run tests when the project has them, play and inspect the Console plus a Game View screenshot, then stop
  Play Mode and report evidence. "It should work" is not a result.
- **`unity-gameplay`** — gameplay code. MonoBehaviour lifecycle ownership (`Awake`/`OnEnable`/`Start`/
  `OnDisable`), symmetric subscription, explicit serialized references over scene-wide searches,
  `[FormerlySerializedAs]` when renaming serialized fields, and per-frame performance discipline.
- **`unity-testing`** — the Test Framework. Choose EditMode for pure logic and PlayMode for the player
  loop/scene lifetime; set up a separate test assembly with `UnityEngine.TestRunner` and NUnit; never ship
  test code in a runtime assembly.
- **`unity-assets`** — asset safety. `.meta` owns the GUID, `.unity`/`.prefab` YAML encodes `fileID`/
  `guid` references, and the Editor (`AssetDatabase`) is the only safe place to move, rename or delete an
  asset; move an asset with its `.meta` and re-verify when that is unavoidable.

## Boundary

`package.json` exports only `./package.json` and declares `pi.skills`; the package has no dependencies and
no build step. Skills are Markdown + frontmatter, read by pi's skill loader after the host stages the
package's skills folder under the extension's owner route ([[submodule-server-extensions]]). A skill may
name the `unity_*` tools; it never calls them itself, and the host never parses skill text.
