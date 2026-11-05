---
name: unity-gameplay
description: "Use when writing or changing Unity gameplay code: MonoBehaviour lifecycle, serialized fields, ScriptableObjects, prefabs, input, physics, coroutines, and performance-sensitive per-frame code."
---

# Unity gameplay code

## Lifecycle and ownership

- `Awake` wires references inside the object; `OnEnable` subscribes; `Start` reads other objects;
  `Update` runs every frame; `FixedUpdate` owns physics; `OnDisable` unsubscribes symmetrically.
- Never assume another object's `Awake` has run before your `Start`. Cache what you own in `Awake`,
  resolve cross-object dependencies in `Start`.
- A destroyed object's callbacks stop; unsubscribe from static events and input actions in
  `OnDisable` or they keep the object alive and fire on a dead instance.
- Prefer explicit references (`[SerializeField]`) over `GameObject.Find`, `FindObjectOfType`, or
  `Camera.main` in hot paths. Scene-wide searches are startup tools, not per-frame tools.

## Serialized state

- `[SerializeField] private` fields are the project's data contract: renaming a field without
  `[FormerlySerializedAs]` silently loses serialized values in scenes and prefabs.
- Public fields are serialized too. Properties are not serialized.
- Initialize serialized collections defensively (`null` from an old asset is common) and do not
  reassign a serialized reference in `Awake` unless that is the intent.
- `ScriptableObject` assets are shared project data. Editing one at runtime in the Editor can persist
  changes; do not mutate shared assets as a shortcut for per-instance state.

## Prefabs and scenes

- Prefab instances carry overrides. Editing the prefab asset changes every instance; editing an
  instance changes only that instance. State which one you mean before editing.
- Do not hand-edit `.prefab` or `.unity` YAML when an Editor API can do it; GUID/fileID mistakes are
  silent and expensive.
- After changing a scene or prefab, run `unity_verify` and look at the Game View. A serialized
  reference that resolves to the wrong object looks fine in code and wrong on screen.

## Performance and input

- Per-frame allocations matter: avoid `GetComponent`, LINQ, string concatenation, and new arrays in
  `Update`/`FixedUpdate`/`LateUpdate`.
- Cache `Camera`, `Rigidbody`, `Animator`, `Renderer`, and input actions.
- Use the project's existing input system. Do not mix the legacy Input Manager and the new Input System
  in one feature; check `Packages/manifest.json` first.
- Physics belongs in `FixedUpdate`; reading input in `FixedUpdate` can miss or repeat presses.
- Use the profiler or a measured counter before claiming a performance improvement.

## C# style

- Match the assembly's existing namespace, file layout, naming, and nullable style.
- Unity's serializer does not run constructors or property initializers on deserialization; do not rely
  on them for scene data.
- Prefer `TryGetComponent` when the component is optional. Use `RequireComponent` for hard dependencies.
- Keep Editor-only code behind `#if UNITY_EDITOR` or an Editor assembly.
