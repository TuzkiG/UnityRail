---
name: unity-testing
description: "Use when adding or fixing Unity tests, setting up an EditMode or PlayMode test assembly, or deciding how to prove Unity behavior with the Test Framework."
---

# Unity tests

## Choose the mode

- **EditMode** runs in the Editor without entering Play Mode: pure C# logic, ScriptableObject rules,
  editor tooling, serialization helpers, math, data transforms. Fast and the default.
- **PlayMode** runs with the player loop and scene lifetime: coroutines, physics, `Update` behavior,
  input simulation, object destruction, scene loading. Slower and can reload the domain.
- A bug that only appears in a player build needs a build/player test or a manual play check; EditMode
  tests cannot prove player-only behavior.

## Assembly setup

- Tests live in their own assembly. Create an `asmdef` for the test folder with references to the code
  under test and to `UnityEngine.TestRunner`, plus `nunit.framework.dll` in
  `precompiledReferences`, and set `includePlatforms: ["Editor"]` for EditMode.
- PlayMode test assemblies use `"includePlatforms": []` (or the project's established platform set) and
  reference `UnityEngine.TestRunner`; the Test Framework supplies the runner.
- Do not put test code in a runtime assembly. It ships to players and slows every build.

## Writing a test

- Name the behavior, not the method: `Jump_WhenGrounded_AddsUpwardVelocity`.
- Arrange explicitly: create the object/scene state, Act once, Assert on observable state. Do not assert
  on incidental implementation details.
- Use `[UnityTest]` with `IEnumerator` and `yield return null`/`WaitForSeconds` only when time or the
  player loop is the subject. Use `[Test]` for pure logic.
- Clean up what you create (`Object.DestroyImmediate` for EditMode assets/objects; destroy runtime
  objects in PlayMode) so the next test starts clean.
- For scene tests, load a dedicated test scene; do not depend on whatever the user has open.
- A test that passes only because the Console had no errors is not enough; assert the state you care
  about.

## Running and reporting

- `unity_tests` with `mode: "edit"` first; use `filter` to run one fixture.
- If a test fails, read the message and stack, then fix the cause. Do not weaken the assertion to make
  it pass.
- An interrupted PlayMode run is not a pass. Re-run with domain reload disabled, or move the assertion
  to an EditMode test if the player loop is not actually required.
