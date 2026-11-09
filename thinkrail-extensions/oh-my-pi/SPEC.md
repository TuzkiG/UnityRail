---
id: module-ext-oh-my-pi
type: module-design
status: active
title: Oh my pi extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api, module-contracts, module-locales, module-ui]
references: [submodule-server-extensions, submodule-web-extensions, submodule-web-panels]
---

## Responsibility

The UnityRail halves of the capabilities borrowed from oh-my-pi. Six optional capabilities share one
extension, one settings page and one set of switches; each switch is applied when a session's factories
build, so a change reaches the next session and never a running turn.

| Switch (`boolean`, default `false`) | Capability | Its `string` setting(s) |
| --- | --- | --- |
| `hashline` | hash-anchored `edit` plus line-numbered `read`, replacing both built-in tools and rejecting stale anchors | — |
| `lspDiagnostics` | language-server diagnostics appended to an edit's result | `lspCommands` |
| `rules` | mid-stream rule injection: patterns abort the turn and re-prompt with the rule | `rulesDir` |
| `advisor` | a second model reads each finished turn and leaves one note | `advisorModel` |
| `modelRouting` | virtual model that routes by role, falls back down a chain, rotates keys | `routerDefault`, `routerFast`, `routerFallback`, `apiKeys` |
| `structuredResults` | subagents answer into a schema-validated envelope | — |

## Boundary

- **Server:** `@thinkrail/ext-oh-my-pi/server` default-exports a `defineServerExtension` named `oh-my-pi`
  with no child extensions, declares the thirteen settings above and reads them through
  `setting(key)`/`stringSetting(key)`. It may import `@thinkrail/extension-api/server`, `typebox` and
  `@earendil-works/pi-coding-agent`; the pi import is runtime code evaluated inside the host process,
  never a browser bundle.
- **Web:** `@thinkrail/ext-oh-my-pi/web` exports the setting-key lists (`OH_MY_PI_TOGGLES`,
  `OH_MY_PI_FIELDS`, `OH_MY_PI_STRINGS`), the extension name, the `MessageKey` copy maps typed
  `satisfies Record<OhMyPiToggle | OhMyPiString, …>` so a key added to `shared/keys.ts` without copy or a
  home fails the typecheck, and the op shape shared with the edit card (`HashlineOp`, `isHashlineOp`,
  `insertedLines`) so the rows it renders split lines exactly as the server writes them; `apps/web`'s
  `OhMyPiSettings` renders the page from those lists and `EditCard` imports the op helpers. It imports
  `@thinkrail/locales` types only and never the server half or a pi package.
- **Forbidden:** host state of its own, a wire method (the six capabilities ride existing pi hooks and
  `settings.update`), teaching `apps/web` the capability names outside this page, and reading or writing
  `AppConfig` fields other than `extensionSettings`.

## Settings page

Settings → Oh my pi (`OhMyPiSettings`, nav `settings-nav-oh-my-pi`, gated at
`EXTENSION_STRING_SETTINGS_PROTOCOL_VERSION` = v111) is one group per switch: the switch itself plus its
string rows. Text fields are `useSettingsDraft` + `saveSettings`, so a failed write reverts to the stored
value; both switches and fields write `settings.update { extensionSettings: { "oh-my-pi": { key } } }` and
converge on the broadcast. The generic Settings → Extensions page keeps boolean rows only, so this page is
the only editor for the seven string settings.

## Hashline

With `hashline` on, the session registers `edit` and `read` under the built-in names.

- `edit` takes `{ path, tag?, ops: [{ from, to, text }] }`: 1-based inclusive line ranges, `from - 1`
  inserts before `from`, and `text: ""` deletes. Ops must be sorted and disjoint; both conditions are
  enforced, not repaired.
- The tag is the first 8 hex digits of `sha256` over the LF-normalized content, BOM stripped and the
  trailing newline dropped, so a read and a later edit of the same bytes agree. A supplied tag that no
  longer matches is refused with the current tag and a re-read instruction, so a stale edit never lands
  on a file another writer changed.
- Each successful edit reports the new tag and stays `EditToolDetails`-compatible (`diff`, `patch`,
  `firstChangedLine`) with the tag and the removed lines per op added; `EditCard` renders each op's
  removed rows, then its inserted rows.
- `read` numbers every returned line, keeps `offset` aligned with real line numbers (a fractional
  offset or limit is floored first, so every label is a whole line `edit` can address) and closes the
  output with the file tag, because the built-in read returns bare text and an op without line numbers
  cannot be addressed while an edit without a tag cannot be anchored. It numbers only addressable lines,
  so a trailing newline does not surface a phantom last line the edit tool would reject, and a read
  whose body has no lines (an offset past the end, a zero limit) stays unnumbered instead of inventing
  one; a 0-byte file has no lines either, so it reads as just its tag and `from: 1, to: 0` inserts its
  first line; it strips only the SDK's trailing notice, so a file containing a notice-shaped line still reads
  as numbered content. The delegated read and the tag read run under the same path mutation queue, so a parallel
  edit cannot land between the numbered lines and the tag that describes them.
- Both tools resolve paths the way the wrapped read does (`~` expansion, `@` prefix, Unicode spaces,
  `file://` URLs and win32 shell paths such as `/d/...`), so a path that opens in `read` also anchors in
  `edit`.
- Op text is LF-normalized (`\r\n` and a trailing lone `\r` dropped) before lines are joined, so a
  model copying the `\r` a CRLF read shows cannot write `\r\r\n` into the file. The leading BOM is
  stripped from what `read` displays and from the assembled content before `restore` puts the original
  back, so a model echoing the line it saw cannot write a second BOM.
- Writes preserve the BOM, the line ending taken from the first line, and the trailing-newline state;
  edits of one path serialize through the SDK's per-path mutation queue, shared with the built-in tools.

## Diagnostics

With `lspDiagnostics` on, a successful `edit`, `write` or `apply_patch` result gains up to 20 lines from
the language server that owns the file: `<severity> <path>:<line> <message>`, each message cut at 500
characters. `.ts/.tsx/.js/.jsx` use `typescript-language-server --stdio`, `.cs` uses `csharp-ls`;
`lspCommands` overrides either with `ts=…; cs=…` (the value is split on whitespace into command and
arguments). Any other extension, a missing server, a spawn failure or a 5-second silence leaves the
result untouched — diagnostics never turn a successful edit into an error, and the server process is
cached per workspace and command, then killed on `session_shutdown`.

The client speaks stdio JSON-RPC with `Content-Length` framing: `initialize`/`initialized`, one
`didOpen` with the full text per check, await `textDocument/publishDiagnostics`, then `didClose`.
`workspace/configuration` requests are answered with an empty list. Only `publishDiagnostics` is
consumed; hover, completion and programmatic queries are out of scope.

## Advisor

With `advisor` on, every `turn_end` that has assistant text or tool output is summarized (assistant text plus
tool text, cut at 4000 characters) and sent to a second model through
`ctx.modelRegistry.complete(model, {systemPrompt, messages}, {maxTokens: 400})`. `advisorModel`
(`provider/id`) picks that model; empty means the session model. The reply is injected as a
`custom_message` with `customType: "oh-my-pi-advisor"` and `display: true`, so it reaches the model and
the transcript, but the advisor never sets `continue` and never blocks a turn. `OK` replies are dropped,
a missing model or a failed call only warns once, and a session spends at most 10 advisor calls.

## Model routing

With `modelRouting` on, the extension registers the virtual model `oh-my-pi/auto`. Its `route()` maps each
request to a physical model: a user turn uses `routerDefault`, a direct call uses `routerFast` then
`routerDefault`, a continuation keeps `request.previous`, and a retry walks `routerFallback` (comma or
newline separated) by attempt, then `previous`, then the default. Every unresolved reference falls back
to the session model, and the thinking level is passed through unchanged. `retry` state carries the
fallback attempt across the branch.

## Credentials

`apiKeys` holds one `provider/model=key1|key2` per line. The pool is used only by extension-initiated
calls — today the advisor — through `complete(model, …, {apiKey})`; the host's own model calls are never
re-keyed. A 401 or 429 marks that key bad for the process and retries the next healthy key; any other
error is rethrown. Keys stay in `config.json` in plain text, like every other extension setting.

## Rules

With `rules` on, the session loads `*.md` files from `rulesDir` (default `~/.pi/agent/oh-my-pi/rules`)
once at build. Frontmatter carries `pattern` (a regex, matched with the `m` flag), `scope: tool|text`,
and optionally `tools` (comma-separated tool names) and `files` (a glob over the call's `path`). The
body is the rule text injected into the turn. A file missing a pattern, a scope or a body, or holding
an invalid regex, is skipped with one `console.warn`; a broken rule never fails a session.

- A `tool` rule matches the tool name plus the JSON of its arguments, after the `tools` and `files`
  filters. On a hit the call is blocked and the model receives `Rule <name> matched.` plus the body, so
  the rule stops the write before it lands.
- A `text` rule matches the assistant text of the finished turn. On a hit `turn_end` appends a
  `custom_message` (customType `oh-my-pi-rule`, displayed) per matching rule, and asks for one more turn
  the first time that rule matches in the session. A later match still shows the note but does not
  retry, which bounds the loop the SDK cannot otherwise stop mid-stream.

## Structured results

`structuredResults` lives in [[module-pi-subagents]]: the host passes the toggle into `createSubagents`
and the runner validates a definition's `result_schema` after the run, so this extension owns the
setting and nothing else. A definition without a schema, or a run whose final text is not JSON,
returns the ordinary bounded report; a mismatch appends the schema errors so the parent can see the
contract failed instead of reading prose as success.

## Status

Shipped: the extension shell, the settings contract, this page, hashline (its `edit`/`read` override
and card), rules, post-edit diagnostics, the advisor, model routing, the extension-scoped credential
pool, and the `structuredResults` switch (enforced by `pi-subagents`). Deferred: diagnostics over a
full protocol beyond `publishDiagnostics`, deep programmatic debugging, persistent language kernels,
an agent-hub roster, and swapping credentials for the host's own model calls.
