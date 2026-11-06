---
id: submodule-server-unity
type: submodule-design
status: active
title: unity — the host's Unity Editor bridge methods
parent: module-server
depends-on: [module-contracts, module-unity-project]
references: [module-ext-unity, submodule-server-extensions]
---

## Responsibility

The host side of the Unity workbench panel and its `unity.*` wire methods. Each method resolves the
workspace's project root and performs one live Editor operation through [[module-unity-project]]. The
host owns no Unity state: there is no cached `UnityProjectInfo`, bridge client, snapshot or compile
result. Every request re-reads the workspace, re-reads bridge discovery and asks the Editor again; a
domain reload only changes the port/token, and `withUnityBridge` rediscovers once.

## Boundary

- **Owns:** `unityProjectRoot(workspaceId)` and the service functions re-exported by `index.ts`, mapped
  one-to-one to the `unity.*` methods registered in the host's `handlers.ts` ([[submodule-server-host]]):
  `unity.projectConfig`, `unity.setProjectConfig`, `unity.linkModule`, `unity.unlinkModule`,
  `unity.snapshot`, `unity.status`,
  `unity.console`, `unity.compile`, `unity.playmode`, `unity.screenshot`, `unity.tests`,
  `unity.hierarchy`, `unity.inspect`, `unity.find`, `unity.open`, `unity.select`, `unity.clearConsole`,
  `unity.doctor`, `unity.openEditor`.
- **Allowed deps:** `@thinkrail/unity-project`, `@thinkrail/contracts` (wire types),
  `@thinkrail/shared/codedError`, and the sibling `workspaces` read (`getWorkspace`) — the same
  request-path read every workspace-scoped feature uses.
- **Forbidden:** the browser, a persistent Unity cache or poll loop, `pi`, and any second structural
  source of truth for scenes/prefabs. The host may read the project *model* (files, asmdefs, GUIDs are
  read-only inputs); it never edits them and never reconstructs the Editor hierarchy itself.

## Project configuration

`unity-projects.json` in the data directory stores one entry per workspace: the chosen Unity project root
(when set, `unityProjectRoot` prefers it over detection, ignoring a stale path), the business-layer folder
whose children are offered for linking, the configured **link target** directory, and the linked modules.
A configured root is validated with a marker-file stat (cached for 30s) rather than a full project read,
because the panel polls the root on a 3s cycle and only a genuinely missing project should fall back to
detection. The Unity Project tab edits the link target directly; its Link action passes that path to
`unity.linkModule`, which then creates or reuses the real `Assets/Game` mount and returns the refreshed
`externalLinks` the panel renders. The mount name is fixed (`Assets/Game` in the framework layout) for
the configured target and every business-folder Link button, so choosing another worktree re-points that
one mount rather than creating a parallel `Assets/<worktree>` link. `unity.linkModule` mounts an external
folder at `Assets/<name>` through [[module-unity-project]] and records `mountPath`/`linkType`; when the
requested `Assets/<name>` already links that target it records the real link instead of creating a
duplicate; when that mount is a directory link to another target it replaces it, restoring the previous
mount if the new link cannot be created, so re-pointing a business worktree keeps the project's
`Assets/Game` mount. A dangling mount (its target moved or was deleted) is removed and re-created instead
of refusing every future link with `UNITY_LINK_EXISTS`. A real project directory at the mount is never
removed. Recorded modules are deduplicated by **canonical** source path and mount path, so a Windows
path-case difference does not leave two rows for one mount. `unity.unlinkModule` removes the mount and
the record, never the source folder, and reports `UNITY_UNLINK_FAILED` when a link that should go away
could not be removed (the record then stays, matching reality). `unity.projectConfig`
also reports `externalLinks` — the directory links the project currently mounts plus its `.gitmodules`
submodules and nested checkouts — read from the **detected** project root as well as a configured one, so
the panel marks which external connection a project uses even before configuration. When no business
layer is stored, it derives one from the first external directory link's target parent; a stored path is
kept while it still contains that target and replaced otherwise, so a re-pointed link never leaves the
folder list pointing at the old worktree. A submodule that is itself a directory link is reported once,
as the link, because that entry carries the folder actually mounted.

## Asset diff and guard

`unityAssetDiff(workspaceId, path, original, modified)` (`assetDiff.ts`) answers the object model of a
`.unity`/`.prefab`/`.asset` diff: it refuses a non-asset path, a workspace without a Unity project,
and a side over 8 MiB (the caller keeps the text diff). GUIDs resolve through the project's cached index,
so a MonoBehaviour shows its script name. The host composes it with `git.diffFile` behind
`unity.assetDiff`; the renderer only receives the result.

`unityAssetGuard(workspaceId, changedPaths)` (`guard.ts`) checks the change set against the project:
an asset under `Assets/` with no `.meta` (error), a changed `.meta` whose asset is gone (warning),
a changed `.meta` whose GUID another asset also owns (error, naming the other path), a file over 2 MiB
with no matching `filter=lfs` rule from the worktree/project `.gitattributes` (warning), and the two
project-wide checks — no `unityyamlmerge` merge driver and no `Library/` ignore entry (warnings).
It reads only changed paths that resolve inside the project's `Assets/`, builds the GUID index only
when a `.meta` changed, and caps findings at 40. It is advisory: nothing is written and a fix is a
draft the user hands to the agent.

## Verification history

`unity.tests` records every answered run through [[submodule-server-verification]] before replying, so a
run started from the chat tool and one started from the Verify panel share one history.

## Error mapping

Every service converts a failure into a `CodedError` with one of four wire codes:

- **`UNITY_NOT_PROJECT`** — the workspace is not inside a Unity project (no
  `ProjectSettings/ProjectVersion.txt` found from the worktree cwd), or a `UnityProjectError` says so.
- **`UNITY_PROJECT_MISMATCH`** — a bridge is running, but for another project (`BRIDGE_PROJECT_MISMATCH`).
- **`UNITY_UNAVAILABLE`** — every other bridge failure: not running, protocol mismatch, auth rejection,
  timeouts, HTTP errors, and a missing Unity install when opening the Editor.
- **`UNITY_LINK_EXISTS` / `UNITY_LINK_FAILED` / `UNITY_UNLINK_FAILED`** — the mount write path: a real
  directory already occupies `Assets/<name>`, the create/replace failed (after a rollback attempt), or a
  recorded link could not be removed.

The message is the bridge/project message verbatim; the code is the classifier the UI and the error
tracking rely on (never parse the message). `unity.snapshot` is the exception below.

## `unity.snapshot`

The panel's first read never throws for a Unity-specific reason; it describes what is true:

```
{ workspaceId, isUnityProject, projectRoot, project, projectError, bridge, bridgeError }
```

- Not a Unity project: `isUnityProject: false`, both payloads `null`, both errors `null` (the panel
  offers "Open in Unity" / project guidance rather than an error).
- Project model and bridge are read **independently**: a read failure lands in `projectError`
  (`UnityProjectError.code`, else `PROJECT_READ_FAILED`) while a bridge failure lands in `bridgeError`
  (`UnityBridgeError.code`, else `BRIDGE_UNAVAILABLE`), so a panel with a broken bridge still shows the
  project, and a project read failure still shows the Editor if one is connected.
- `project` is a structural projection for the wire: package names/versions/builtin, assembly nodes
  (name, path, `editorOnly`, resolved references, missing references), scenes, prefabs, counts and
  warnings — not the Node `UnityProjectInfo` (which also carries the bridge discovery and GUID index).
- `bridge` is the live `UnityBridgeStatus` (play/pause/compile/update flags, active scene, selection,
  last compile, console sequence).

All other methods require a project and reject with the mapping above.

## `unity.status`

The ambient read for live surfaces (the composer's Editor-selection chip) that need the Editor alone:
`{ isUnityProject, bridge }`, reusing the same 3 s-cached bridge status as `unity.snapshot` and never
reading the project model. `bridge` is `null` when no Editor answered; the result never throws for a
Unity-specific reason, so a poller can keep its cadence and stop when `isUnityProject` is false.

## `unity.openEditor`

The host-level "Open in Unity" action. If bridge discovery exists for the project, it is already open:
report `{ started: false, editorPath: status.applicationPath, pid: discovery.pid }`, and if the status
call fails still report `{ started: false, editorPath: "", pid }` rather than launching a second Editor.
Otherwise `openUnityProject` resolves the install for the project's editor version and launches it
detached; `UNITY_INSTALL_NOT_FOUND` becomes `UNITY_UNAVAILABLE`. The bridge comes up later — the method
does not wait for it.

## Wire shapes and clamps

`packages/contracts/src/unity.ts` holds the browser-safe structural copies of the bridge types; the host
maps bridge responses into them. The host clamps `unity.screenshot` width to 64–1920 (the agent tool uses
64–1600, and the panel asks for 1280). The payload is `{ view, mimeType, base64, width, height, bytes }`;
the panel builds its own `data:` URL from `base64`.
`unity.doctor` maps `diagnoseUnityWorkspace` to `UnityDoctorReport`, dropping the extra `bridge` and
`workspaceIsUnityProject` fields.
