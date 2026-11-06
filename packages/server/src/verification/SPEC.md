---
id: submodule-server-verification
type: submodule-design
status: active
title: verification — the workspace's test-run history
parent: module-server
depends-on: [module-contracts]
tags: [unity, persistence]
---

## Responsibility

The small durable history behind the Verify panel: the test runs the host itself answered for a
workspace (`unity.tests`), newest first. An agent tool call reaches the bridge from its extension and
is not recorded here — its chat card shows the result inline. It stores what the run reported (state,
counts, per-test results with their messages and stack traces) and nothing the run did not report; it
never re-runs, schedules, or interprets a test.

## Boundary

- **Owns:** `recordUnityTestRun(workspaceId, run, filter?)`, `listVerificationRuns(workspaceId)`,
  `forgetWorkspaceVerification(workspaceId)`; the on-disk shape at
  `~/.thinkrail/verification-runs/<workspaceId>.json`.
- **Writes:** one JSON file per workspace, written atomically (temporary file + rename), capped at the
  newest 20 runs. A run keeps at most 400 results, **failed results first**, and each message/trace is
  truncated (4 KB / 16 KB); `resultsTruncated` says the entry was cut. Writing a history entry never
  fails the test run itself.
- **Reads:** the file is untrusted input; a malformed entry is dropped rather than rendered.
- **Forbidden:** running tests, touching the Unity bridge, or deciding a run's verdict. The host's
  `unity.tests` handler records the answer; the bridge and `server/unity` own the run.

## Consumers

`host` records every `unity.tests` answer and serves `verification.list`; `apps/web`'s Verify panel
renders the history and opens a failing test's stack frame in the code view. Detail:
[[submodule-server-host]], [[submodule-server-unity]].
