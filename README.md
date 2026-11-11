# UnityRail

[![English](https://img.shields.io/badge/lang-English-2f81f7)](README.md) [![简体中文](https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-d73a4a)](README.zh-CN.md)

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)
[![GitHub stars](https://img.shields.io/github/stars/JetBrains/thinkrail?style=social)](https://star-history.com/#JetBrains/thinkrail&Date)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20chat-5865F2?logo=discord&logoColor=white)](https://thinkrail.ai/discord)

UnityRail is the agentic IDE that gets better every time you use it — learning your project through
living specs today, and building its own capabilities tomorrow.

We built a rich interface around the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent, isolated work into separate workspaces, and gave the agent durable project knowledge
through living specs and reusable skills. Next, we're adding full extension support, so UnityRail can
create the tools it needs based on how you actually work.

**Website:** [thinkrail.ai](https://thinkrail.ai/) · **Blog:** [thinkrail.ai/blog](https://thinkrail.ai/blog/) ·
**Discord:** [thinkrail.ai/discord](https://thinkrail.ai/discord)

⭐ If you find UnityRail useful, give it a star — it helps others discover it.

<p align="center">
 <a href="https://www.star-history.com/jetbrains/thinkrail">
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=rank&theme=dark" /><source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=rank" /><img alt="Star History Rank" src="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=rank" /></picture> <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=trending&theme=dark" /><source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=trending" /><img alt="GitHub Trending Repository of the Day" src="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=trending" /></picture>
 </a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/readme-assets/workbench-dark.png">
  <img src=".github/readme-assets/workbench-light.png" alt="UnityRail workbench: the Projects pane beside the left tool rail listing worktree workspaces and their Settled shelf, a finished pi conversation with its tool steps in the center, the resulting diff beside it, and the Specs tree above the Changes list on the right with their tools on the edge rail" width="900">
</picture>
*From the left: An isolated workspace, a work session with an AI agent in that workspace, the code change made by the agent, and the spec tree.*

<a id="install"></a>

## Installation

ThinkRail ships in two forms: a native desktop installer and the self-contained `thinkrail` CLI. You can install them from out [Landing page](https://thinkrail.ai/#install).

For latest version, see the [Releases page](https://github.com/JetBrains/thinkrail/releases).


## What you get

- **Isolated workspaces.** Open any git repo as a project and cut workspaces from it as `git worktree`s,
  each with its own branch and working directory. Agents work in parallel without touching your
  checkout; merge the good branch, delete the rest. New worktrees initialize their submodules, and
  Changes/Review follow edits inside nested repositories at any depth, including a business checkout mounted by a directory link. You can also attach existing worktrees or explicitly
  work in the project folder itself, and each project can preset which of the two its New-Workspace dialog
  opens in. Finished and dormant workspaces settle onto a per-project shelf on
  their own — when their pull request merges or closes, or after a quiet week — and come back the moment
  you work in them. The topbar shows where the active branch stands against `origin` and its pull request,
  with the next step one click away: publish, push, or open a PR described from the plan, the commits,
  your PR template, or an agent-written draft. Once a GitHub PR is open it shows the CI checks and review
  decision, and lets you mark it ready, hand failing checks or a diverged branch to the agent, merge it
  with the repository's last-used method, reopen it, or delete the remote branch.
- **A real IDE around the agent.** A splittable workbench of Monaco editor tabs, a Files tree with live git
  change marks and a Changed view, terminals, and documents — all scoped to the active workspace. Leave
  anchored review comments on files and diffs and send them to a chat as structured context, or open the
  worktree in your installed IDE.
- **Chats that stream like the engine thinks.** Several concurrent `pi` sessions per workspace, each with
  its own model and live token and cost readout. Steer a running turn or queue a follow-up, delegate to
  subagents, and work a shared plan the agent updates and you edit — each completed step can be committed
  and reviewed on its own.
- **Find anything from one box.** `⌘K` (or a double tap of Shift) opens a palette that finds chats and
  the messages inside them, workspaces and projects, files in the current workspace, specs, and plans,
  with a preview pane. It also runs the app's commands with their shortcuts shown and opens Settings
  sections, and with nothing typed it lists the chats waiting for you. Type a task and press `⌘↵` to
  open Create workspace with it as the prompt.
- **Specs as ground truth.** A connected graph of `SPEC.md` files lives beside the code; the agent reads,
  searches, and maintains it through dedicated `spec_*` tools, so intent survives the session. The
  read-only Specs tool renders the graph as a tree in the workbench.
- **Memory that outlives a session.** Connect [Basic Memory](https://docs.basicmemory.com/integrations/pi)
  from Settings → Memory: the official Pi package recalls the decisions, rationale and next steps of
  earlier sessions and captures new ones after a turn settles. Its notes are plain Markdown in your own
  Basic Memory projects, listed and editable on the same page — and a project's notes open as a
  workbench tab from the project menu. Each project can pick the Basic Memory project it targets and
  whether recall and capture run automatically.
- **Skills and workflows.** UnityRail loads your `pi` skills and any already in your project, and can
  import skills from Claude, Codex, and other coding agents: switch them on in Settings → Extensions, or
  per project in the Skills dialog, which also shows the size of your skill catalog. A large library is
  listed within a small prompt budget, and the agent finds the rest with a skill search. Bundled
  workflows guide project setup, design brainstorming, and shipping a pull request — pushing the
  workspace branch and opening or updating its GitHub PR through your own `gh`.
- **Agent tools beyond the shell.** Web research, structured multiple-choice questions the agent asks you
  in the chat instead of guessing — with mockups, diagrams and diffs right in the question, your own answer
  and notes, a one-click "Discuss" when a question is unclear, and a fully keyboard-driven card — and inline
  diagrams, option comparisons and file previews rendered right in the chat — when the agent proposes a UI
  change it shows a before/after mockup you can comment on like a diff. Settings → Extensions lists the
  UnityRail extensions the agent gets and lets you switch each one off (and, for questions, their rich
  previews) — and installs any `pi` package by source (npm, git or a local folder), for you or for a repository,
  showing what each one adds and letting you switch packages, their individual extensions and skills, and
  pi's built-ins on or off; open chats pick a change up when their turn ends. The questions and visualize
  tools are also published as plain `pi` packages, one each —
  `pi install npm:@thinkrail/pi-ask-user-question` for the questions
  ([`@thinkrail/pi-ask-user-question`](https://www.npmjs.com/package/@thinkrail/pi-ask-user-question)) and
  `pi install npm:@thinkrail/pi-visualize` for the diagrams and previews
  ([`@thinkrail/pi-visualize`](https://www.npmjs.com/package/@thinkrail/pi-visualize)) — so a vanilla `pi`
  in the terminal gets the same tools.
- **MCP servers.** Connect the MCP servers in your `pi` `mcp.json` (or add them, and a few presets, from
  Settings): UnityRail asks in the chat before calls the server does not mark read-only (or always allows
  the tools you trust in a project), keeps servers a repository
  defines off until you approve them, signs you in to OAuth servers from Settings, and shows each chat's
  servers next to its background commands and subagents.
- **Your providers, your credentials.** Sign in with [JetBrains AI](https://www.jetbrains.com/ai/) or
  connect any provider through `pi`'s own auth. UnityRail has no accounts of its own.
- **Your pi setup.** UnityRail reads your existing `pi` configuration (`~/.pi/agent`). To use another one
  — say a personal `~/.pi/agent-personal` — or to pass extra environment variables to the agent, terminals
  and MCP servers, set them in Settings → Environment; they apply on the next start. A variable you set
  when launching (`PI_CODING_AGENT_DIR=… thinkrail`) still wins.
- **Your own model servers.** Settings → Providers → **Custom servers** connects a company LLM gateway or a
  model running on your own machine — any OpenAI-compatible server, such as LiteLLM, sglang, vLLM, Ollama,
  LM Studio or llama.cpp. **Find models** lists what the server serves, with the context and capabilities it
  reports. The server is saved to `pi`'s `models.json`, so its models appear in the chat model picker and in
  the `pi` CLI alike.
- **Desktop app or browser.** A native desktop app, or the `thinkrail` CLI that opens the same app in your
  browser. Both embed the same engine host; app state lives under `~/.thinkrail`.
- **Your language.** Settings → Language follows your system language or a language you pick; English,
  Japanese, Russian, Simplified Chinese, and Spanish are built in. Add a language UnityRail doesn't ship yet by
  dropping a translated locale file (for example `de.json`) into `~/.thinkrail/locales` — it applies as you
  save. Agent replies and tool output stay as the agent wrote them.
- **Your themes.** Settings → Appearance ships dark, light, minimal and high-contrast themes. Make your own
  by copying a bundled `*.theme.json`, changing its id and colors, and saving it to `~/.thinkrail/themes`.
- **Your fonts.** Settings → Appearance picks the interface and code fonts from the bundled Geist and
  JetBrains Mono, any font installed on your computer, or font files you drop in (kept in
  `~/.thinkrail/fonts`), with fallback fonts for icon glyphs, a code size, ligatures and a text-weight slider.
- **Unity projects.** In a workspace inside a Unity project, the agent can compile, read the Console,
  drive Play Mode, capture the Game or Scene view, run EditMode and PlayMode tests, and inspect the scene
  hierarchy through a small Editor bridge package — with a Unity panel for the same view. What you select
  in the Editor also appears beside the chat input and reaches the agent as context. Setup and
  limits are in [Unity](#unity).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/readme-assets/specs-dark.png">
  <img src=".github/readme-assets/specs-light.png" alt="The Specs tool, opened from the right edge rail, listing the project's spec tree while the product goal spec is rendered in the editor" width="900">
</picture>
*The project's spec graph as a tree (on the right), with the spec itself rendered alongside in the center.*

*The project's spec graph as a tree, with the spec itself rendered alongside.*

### Unity

Open a folder that is inside a Unity project and UnityRail finds the project root, its editor version,
packages, assembly definitions and scenes. With the Editor bridge package installed and the project open
in Unity, the agent stops guessing: it can wait for a compile and read the compiler diagnostics, read
and clear the Console, enter, pause and stop Play Mode, capture the Game View or Scene View as an image
it can inspect, run EditMode and PlayMode tests, and read the open scene's hierarchy and components. A
Unity tool in the workbench shows the same overview, Console, hierarchy, inspectors, Game View and test
results without spending a chat turn, and bundled Unity skills cover project orientation, verification,
gameplay code, testing and asset safety. The object selected in the Editor shows beside the chat input
and rides into the agent's context on its next turn, so "fix this" starts from what you are looking at.
If something is missing, `unity_doctor` (and the panel's overview) says whether it is the project, the
Unity install, or the bridge.

The bridge is the Editor-only package `com.thinkrail.bridge` in this repository under
`unity-package/com.thinkrail.bridge`. Add it to the project's `Packages/manifest.json` as a local file
dependency (or copy the folder into `Packages/`), then open the project in Unity; the bridge starts with
the Editor by default, and **Tools → UnityRail → Start Unity Bridge** starts it manually. It listens on
`127.0.0.1` only and needs no account. Verified against Unity 2022.3 LTS (2022.3.62f3), with Unity 6 as a
target to validate before release, Windows first. The
Editor remains the source of truth: UnityRail reads and drives it, but does not edit scene or prefab
structure for you.

## Install

UnityRail ships in two additive forms: a native desktop installer and the self-contained `thinkrail` CLI.
Both are published with `SHA256SUMS` on the [releases page](https://github.com/JetBrains/thinkrail/releases).

### Desktop

Download the `thinkrail-desktop-*` asset for your platform:

- **macOS 14+ (Apple Silicon or Intel)**: open the DMG for your architecture: `thinkrail-desktop-darwin-arm64.dmg` or `thinkrail-desktop-darwin-x64.dmg`.
- **Windows x64**: extract the complete setup ZIP, then run the executable.
- **Linux x64 / ARM64**: extract the setup tarball and run `installer`. Desktop builds need glibc 2.38+ with GTK 3, WebKitGTK 4.1, Ayatana AppIndicator 3, librsvg 2, and Ubuntu 24.04 or newer:

  ```bash
  sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2
  ```

Packaged stable and nightly desktop builds check for updates in the background and offer them in
**Settings → Updates**: **Download** → **Preparing update** → **Install & Restart**. Nothing is applied until
you choose **Install & Restart**. UnityRail then shows the installation's progress and log, closes, and
reopens on the new version. After the restart it tells you whether the update installed. If it didn't, it
explains why and offers to retry. The updater appears only when the package carries a valid HTTPS feed
identity; installations that predate that identity need one manual installation first.
### Command line

The installer downloads the right binary, verifies its SHA-256 checksum, and puts `thinkrail` on your PATH.

**macOS / Linux** (also Windows under Git Bash):

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
```

**Windows**: the same command works from cmd and PowerShell:

```powershell
powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"
```

Then run `thinkrail`, optionally with a git repo to open as a project:

```bash
thinkrail ~/code/my-repo
```

`thinkrail` needs `git` on your PATH and a model provider — sign in with JetBrains AI from the app or use
your own provider credentials. The first launch walks you through connecting a provider and picking a
project; **Start a new project** creates an empty git repository (under `~/thinkrail` by default), so you
don't need one ready. **Add project → Clone repository…** clones a Git URL into a new folder on the
computer running UnityRail and opens it as a project. Choose the parent folder and folder name, optionally
limit the history depth, or cancel an in-progress clone. GitHub and other Git hosts work with the host's
existing Git credentials and SSH keys; existing destination folders are never overwritten.
`thinkrail --help` lists the flags; `thinkrail --version` prints the build.

<details>
<summary><strong>Nightly builds, pinned versions, updates, and uninstall</strong></summary>
The installer takes `--channel stable|nightly` and `--version`; a pinned version must belong to the
selected channel:

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --channel nightly
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --channel stable --version 0.3.1
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --channel nightly --version 0.4.0-nightly.2
```

On Windows the options are environment variables (`THINKRAIL_CHANNEL`, `THINKRAIL_VERSION`, `THINKRAIL_PREFIX`, `THINKRAIL_NO_MODIFY_PATH`):

```powershell
$env:THINKRAIL_CHANNEL='nightly'; irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex   # PowerShell
set "THINKRAIL_CHANNEL=stable" && set "THINKRAIL_VERSION=0.3.1" && powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"   # cmd
```

If you keep ThinkRail running, it periodically checks for updates and, when it finds one, shows an "Update available" button in the GUI.

`thinkrail uninstall` removes the executable, the PATH entry the installer added, and the install metadata; it then asks whether to delete your `~/.thinkrail` app state (kept by default; `--remove-data` deletes it, and `-y` skips the questions).

If you prefer a manual install, download a binary and the `SHA256SUMS` from the releases page, and verify the checksum. For self-update to work, rename it to `thinkrail` (`thinkrail.exe` on Windows) and place it at `<prefix>/bin/thinkrail[.exe]`; a binary kept under its release filename or elsewhere must be replaced manually or reinstalled with the script.

</details>

### Platform notes

| Platform | Desktop | CLI |
| --- | --- | --- |
| macOS Apple Silicon / Intel | DMG | signed binary |
| Windows x64 | signed setup executable and app binaries | signed `.exe` |
| Linux x64 / ARM64 | setup tarball, unsigned | unsigned |

JetBrains signs the Windows CLI, the desktop setup executable, and every executable and DLL the desktop app installs. The macOS CLI is signed but not yet notarized. Signed and notarized desktop DMGs must come from the coordinated JetBrains service pipeline; older published DMGs and locally built packages may still be unsigned and blocked by Gatekeeper. Linux artifacts are unsigned.

## Analytics & privacy

UnityRail apps collect basic usage events — launches, chat creation, message sends, provider connections — tied to
a random installation ID. Usage analytics never include prompts, code, files, credentials, or account
identity. Error reports are also always sent, tied to the same installation ID, so we can fix crashes: the
error type and code and where in UnityRail's own code it happened. They never include error messages, file
paths, names, URLs, or anything from your projects or extensions. Additional product
usage and how you found UnityRail are shared only while **Share additional usage
data** is on; the switch is offered as a step of first-run setup (or right after you skip it) and lives in **Settings → Privacy**. When launching from
the command line, `thinkrail --no-analytics` (or `THINKRAIL_NO_ANALYTICS=1`) turns additional sharing off for
that run. With additional sharing on, a packaged build may open the UnityRail blog in your browser once to
link your installation to the website visit that brought you here — only where you accepted marketing cookies on the
website or no consent is required — and that link expires after 30 days.

Feedback surveys are separate from usage analytics. UnityRail may invite you to a short survey, and you can
also open it from **Settings → Feedback**. Your answers, including anything you type, are sent to the
UnityRail team only when you press **Send**, whatever your analytics settings, and are tied to the same
random installation ID — not to your name or account. Please don't include secrets, code, or personal data;
to have your answers deleted, email info@thinkrail.ai.

The UnityRail apps and the UnityRail website ([thinkrail.ai](https://thinkrail.ai)) use PostHog Inc. services for
analytics. The website also uses PostHog Surveys to collect feedback after a desktop download and, only if you
choose to enter one, your email address, which is used to ask for further feedback and to send product updates.
PostHog's privacy policy is at [posthog.com/privacy](https://posthog.com/privacy).

## Under the hood

UnityRail is a thin host that runs `pi` in-process and bridges it to a rich web UI. `pi` owns models,
skills, compaction, cost, and session state; the app owns the workspace, the editor, and the wire — it
never assembles prompts behind your back. Three rings:

* **Engine** (`packages/server` + `packages/shared`): a `Bun.serve` HTTP+WS host with one in-process `pi` session per chat, launched by `apps/cli` or `apps/desktop`.
* **Contracts** (`packages/contracts`): the typed, versioned protocol between the engine and the GUI.
* **GUI** (`apps/web`): React 19 + Zustand + Tailwind v4, shipped independently; it communicates with the engine through the contracts.

[`goal-and-requirements.md`](goal-and-requirements.md) and [`architecture.md`](architecture.md) are the
canonical product and design specs. UnityRail is developed spec-first: a `SPEC.md` sits beside every
module, and a change that moves a boundary, contract, or decision updates the spec in the same change.

## Developing UnityRail

You need **Bun** 1.4.4 (the pinned package manager and runtime), **Node.js** ≥ 22.23.4 (the in-process `pi`
engine needs ≥ 22.19; the website build and typecheck need ≥ 22.23.4 for Astro 7.4), and an AI provider for
agent work.

```bash
git clone https://github.com/JetBrains/thinkrail.git
cd thinkrail
bun install
bun run dev                          # host + web client together; Ctrl+C stops both
```

```bash
bun run --filter @thinkrail/cli dev  # browser launcher
bun run build:binary                 # standalone CLI artifact
bun run desktop:dev                  # package and open the Electrobun app
bun run desktop:build                # package without opening it
```

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers the checks, the end-to-end suites, desktop packaging, and the repository layout.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md). This project and community are governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Community

Join us on [Discord](https://thinkrail.ai/discord) to ask questions, share what you're building, and talk to the team. Bugs and feature requests go to [GitHub issues](https://github.com/JetBrains/thinkrail/issues).

## License

Licensed under the [Apache License 2.0](LICENSE).
