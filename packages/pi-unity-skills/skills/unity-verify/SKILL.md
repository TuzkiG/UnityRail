---
name: unity-verify
description: "Use after changing Unity code, scenes, prefabs, or assets, and whenever you are about to claim that a Unity change works. Covers compile, Console, Play Mode, Game View screenshots and tests."
---

# Verify in Unity

Unity is a runtime, not a type checker. A change is unverified until the Editor has compiled it and,
for behavior, you have seen it run.

## The loop

1. **Compile** — `unity_compile`. Read every error, not only the first. Warnings that indicate a
   missing reference or an obsolete API matter. Unity may domain-reload; the tool waits for the result.
2. **Clear the baseline** — `unity_console` with `clear: true` before a fresh run, or remember
   `nextSeq`, so old errors are not blamed on the new change.
3. **Test when the project has tests** — `unity_tests` with `mode: "edit"` for pure logic. Use
   `mode: "play"` only when the behavior needs the player loop or scene lifetime.
4. **Run** — `unity_playmode` with `action: "play"`, wait for startup, then `unity_console` since the
   baseline and `unity_screenshot` on the Game View. Use `pause`/`step` for frame-level checks.
5. **Stop** — `unity_playmode` with `action: "stop"`. Never leave Play Mode running after a failed
   check unless the user asked to keep it.
6. **Report evidence** — name what you compiled, what you ran, what the Console showed, and what the
   screenshot showed. "It should work" is not a result.

`unity_verify` does steps 1–5 in one call (compile → optional tests → play → screenshot → console →
stop). Use it for a smoke check; use the individual tools when you need to inspect an intermediate
state or keep Play Mode running.

## Reading Unity failures

- `error CS####` is a compiler error: fix it before doing anything else. `warning CS####` is a
  compiler warning; do not silence it unless the project already suppresses that class of warning.
- A Console `Exception` during Play Mode is usually a runtime bug even if the compile passed. Read the
  first exception, not the cascade it causes.
- `MissingReferenceException`, `NullReferenceException` on a serialized field, and "object has been
  destroyed" often mean the scene/prefab wiring is wrong, not the C# expression.
- A screenshot that is black, empty, or shows the wrong scene means the run is not valid: check the
  active scene, cameras, and whether Play Mode actually started.

## Boundaries

- Unity's domain reload invalidates in-memory state. Re-read status after play/compile transitions.
- If the bridge says the Editor has a different project open, do not drive it: open this workspace in
  Unity (`unity_open_editor`) or ask the user which project to use.
- PlayMode tests can reload the domain. An interrupted test run is not a pass; report it and re-run
  with EditMode tests or with domain reload disabled.
