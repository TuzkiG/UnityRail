# UnityRail

[![English](https://img.shields.io/badge/lang-English-2f81f7)](README.md) [![简体中文](https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-d73a4a)](README.zh-CN.md)

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)
[![GitHub stars](https://img.shields.io/github/stars/JetBrains/thinkrail?style=social)](https://star-history.com/#JetBrains/thinkrail&Date)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20chat-5865F2?logo=discord&logoColor=white)](https://thinkrail.ai/discord)

UnityRail 是一个会随着使用越来越好用的智能体 IDE —— 今天通过持续维护的规格（living specs）学习你的项目，明天则自己构建所需的能力。

我们围绕 [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 编码智能体构建了丰富的界面，把工作隔离到独立的工作区，并通过持续维护的规格与可复用的技能，为智能体提供持久的项目知识。接下来我们会加入完整的扩展支持，让 UnityRail 能根据你实际的工作方式创造它需要的工具。

**网站：** [thinkrail.ai](https://thinkrail.ai/) · **博客：** [thinkrail.ai/blog](https://thinkrail.ai/blog/) ·
**Discord：** [thinkrail.ai/discord](https://thinkrail.ai/discord)

⭐ 如果你觉得 UnityRail 有用，欢迎点个 Star —— 这能帮助更多人发现它。

<p align="center">
 <a href="https://www.star-history.com/jetbrains/thinkrail">
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=rank&theme=dark" /><source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=rank" /><img alt="Star History Rank" src="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=rank" /></picture> <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=trending&theme=dark" /><source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=trending" /><img alt="GitHub Trending Repository of the Day" src="https://api.star-history.com/badge?repo=JetBrains/thinkrail&type=trending" /></picture>
 </a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/readme-assets/workbench-dark.png">
  <img src=".github/readme-assets/workbench-light.png" alt="UnityRail 工作台：左侧工具轨旁的项目面板列出 worktree 工作区及其 Settled 收纳架，中间是一段已完成的 pi 对话及其工具步骤，旁边是它产生的 diff，右侧是 Changes 列表上方的 Specs 树，这些工具都在边缘工具轨上" width="900">
</picture>

*一段 `pi` 会话与它产生的变更，范围限定在隔离的 git worktree 工作区中。*

## 主要特性

- **隔离的工作区。** 把任意 git 仓库作为项目打开，并从它切出一个个 `git worktree` 工作区，每个都有自己的分支和工作目录。多个智能体可以并行工作而不碰你的检出；合并好用的分支，删掉其余的。新建 worktree 会初始化其子模块，Changes/Review 会跟踪任意深度嵌套仓库中的编辑，包括通过目录链接挂载的业务检出。你也可以挂载已有的 worktree，或明确要求在项目目录本身工作。完成的和休眠的工作区会自动归入按项目分组的 Settled 收纳架 —— 当对应的 Pull Request 合并或关闭时，或安静一周之后 —— 而一旦你回到其中工作，它们会立刻回来。顶栏显示当前分支相对 `origin` 和其 Pull Request 的位置，下一步一键可达：发布、推送，或用计划、提交、你的 PR 模板或智能体草稿生成 PR 描述并打开 PR。GitHub PR 打开后会显示 CI 检查和评审结论，并允许你标记为 ready、把失败的检查或分叉的分支交给智能体、沿用仓库上次使用的合并方式合并、重新打开或删除远端分支。
- **围绕智能体的真正 IDE。** 可拆分的 Monaco 编辑器标签工作台、带实时 git 变更标记和 Changed 视图的 Files 树、终端和文档，全部限定在当前工作区。在文件和 diff 上留下锚定的评审评论并作为结构化上下文发给聊天，或用你安装的 IDE 打开这个 worktree。
- **像引擎思考一样流式输出的聊天。** 每个工作区可同时运行多个 `pi` 会话，各有自己的模型、实时 token 与费用读数。你可以在一轮运行中转向（steer）或排队一条后续消息（follow-up）、委派给子智能体，并共同推进一份由智能体更新、你也能编辑的共享计划 —— 每个完成的步骤都可以单独提交和评审。
- **一个搜索框里找聊天、跑命令。** `⌘K`（或连按两次 Shift）打开命令面板，可跨所有已打开的项目搜索聊天、工作区和项目，运行应用命令（附带快捷键），并跳转到某个设置分区。没有输入时，它会列出正在等你的聊天。
- **规格即事实来源。** 与代码并存的 `SPEC.md` 文件构成一张连通的图；智能体通过专用的 `spec_*` 工具读取、搜索和维护它，让意图在会话结束后仍然留存。只读的 Specs 工具会把这张图渲染成工作台中的树。
- **技能与工作流。** 你为其他编码智能体保留的可移植 Agent Skills 会被就地读取；内置工作流会引导项目搭建、设计头脑风暴和发布 PR —— 通过你自己的 `gh` 推送工作区分支并打开或更新 GitHub PR。
- **shell 之外的智能体工具。** 网页研究、智能体在聊天中向你提出的结构化多选题（而不是靠猜），以及直接渲染在聊天里的内联图表、选项对比和文件预览 —— 当智能体提议 UI 改动时，会展示一份可像 diff 一样评论的前后对比稿。**设置 → 扩展** 列出智能体可用的 UnityRail 扩展，并允许逐个关闭；还可按来源（npm、git 或本地文件夹）为你或某个仓库安装任意 `pi` 包，展示每个包新增了什么，并允许你分别开关包、其中的单个扩展与技能，以及 pi 的内置项；已打开的聊天下一次回合结束时就会拾取变更。问题和 visualize 工具也各自以普通 `pi` 包发布 —— 问题工具用 `pi install npm:@thinkrail/pi-ask-user-question`（[`@thinkrail/pi-ask-user-question`](https://www.npmjs.com/package/@thinkrail/pi-ask-user-question)），图表与预览用 `pi install npm:@thinkrail/pi-visualize`（[`@thinkrail/pi-visualize`](https://www.npmjs.com/package/@thinkrail/pi-visualize)）—— 这样终端里的原版 `pi` 也能获得同样的工具。
- **MCP 服务器。** 连接 `pi` 的 `mcp.json` 中的 MCP 服务器（也可以从设置里添加，并使用若干预设）：服务器未标记为只读的调用，UnityRail 会在聊天中先询问（或在你信任的项目中始终允许）；仓库定义的服务器在你批准前保持关闭；可从设置登录 OAuth 服务器；每个聊天的服务器会显示在它的后台命令和子智能体旁边。
- **你的供应商，你的凭据。** 用 [JetBrains AI](https://www.jetbrains.com/ai/) 登录，或通过 `pi` 自己的认证连接任意供应商。UnityRail 没有自己的账号体系。
- **沿用你的 pi 配置。** UnityRail 读取你现有的 `pi` 配置（`~/.pi/agent`）。如果想用另一套 —— 比如个人的 `~/.pi/agent-personal` —— 或给智能体、终端和 MCP 服务器传额外环境变量，可在 **设置 → 环境** 中配置，下次启动生效。启动时设置的变量（`PI_CODING_AGENT_DIR=… thinkrail`）仍然优先。
- **自建模型服务器。** 设置 → 提供方 → **自定义服务器** 可连接公司 LLM 网关或运行在本机的模型 —— 任何兼容 OpenAI 的服务器，如 LiteLLM、sglang、vLLM、Ollama、LM Studio 或 llama.cpp。**查找模型** 会列出服务器提供的模型，以及它报告的上下文容量和能力。服务器会保存到 `pi` 的 `models.json`，因此其模型会同时出现在聊天模型选择器和 `pi` CLI 中。
- **桌面应用或浏览器。** 原生桌面应用，或在你浏览器中打开同一应用的 `thinkrail` CLI。两者内嵌同一个引擎宿主；应用状态位于 `~/.thinkrail`。
- **你的语言。** **设置 → 语言** 跟随系统语言或你选择的语言；内置英语、日语、俄语、简体中文和西班牙语。把翻译好的 `en.json` 放入 `~/.thinkrail/locales` 即可添加 UnityRail 尚未内置的语言 —— 保存即生效。智能体回复和工具输出保持智能体原本写出的样子。
- **你的主题。** **设置 → 外观** 内置深色、浅色、极简和高对比度主题。复制一份内置的 `*.theme.json`，改掉 id 和颜色，保存到 `~/.thinkrail/themes` 即可自制。
- **你的字体。** **设置 → 外观** 可从内置的 Geist 与 JetBrains Mono、系统已安装的任意字体，或你拖入的字体文件（保存在 `~/.thinkrail/fonts`）中选择界面和代码字体，并设置图标字形的回退字体、代码字号、连字和字重滑块。
- **Unity 项目。** 在 Unity 项目内的工作区中，智能体可以编译、读取 Console、驱动 Play Mode、截取 Game 或 Scene 视图、运行 EditMode 与 PlayMode 测试，并通过一个小型 Editor 桥接包检查场景层级 —— 还有展示同一视图的 Unity 面板。你在 Editor 中选中的对象也会出现在聊天输入框旁，并作为上下文进入智能体。安装与限制见 [Unity](#unity)。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/readme-assets/specs-dark.png">
  <img src=".github/readme-assets/specs-light.png" alt="从右侧边缘工具轨打开的 Specs 工具，列出项目的规格树，同时在编辑器中渲染产品目标规格" width="900">
</picture>

*项目的规格图以树的形式展示，规格本身在旁侧渲染。*

### Unity

打开一个位于 Unity 项目内的文件夹，UnityRail 会找到项目根目录、编辑器版本、包、程序集定义和场景。安装 Editor 桥接包并在 Unity 中打开项目后，智能体就不再靠猜：它可以等待编译并读取编译器诊断，读取和清空 Console，进入、暂停和停止 Play Mode，把 Game 或 Scene 视图截成可检查的图像，运行 EditMode 与 PlayMode 测试，并读取当前场景的层级和组件。工作台中的 Unity 工具无需消耗聊天回合即可展示同样的概览、Console、层级、检视、Game 视图和测试结果；内置 Unity 技能覆盖项目导览、验证、玩法代码、测试和资源安全。Editor 中选中的对象会显示在聊天输入框旁，并在下一轮进入智能体上下文，因此一句“修一下这个”就从你眼前的物体开始。若缺少什么，`unity_doctor`（以及面板概览）会说明问题在项目、Unity 安装还是桥接。

桥接是仅 Editor 使用的包 `com.thinkrail.bridge`，位于本仓库的 `unity-package/com.thinkrail.bridge`。将其作为本地文件依赖加入项目的 `Packages/manifest.json`（或把文件夹复制进 `Packages/`），然后在 Unity 中打开项目；桥接默认随 Editor 启动，也可手动通过 **Tools → UnityRail → Start Unity Bridge** 启动。它只监听 `127.0.0.1`，不需要账号。已在 Unity 2022.3 LTS（2022.3.62f3）上验证，Unity 6 作为发布前待验证目标，优先 Windows。Editor 仍是事实来源：UnityRail 读取并驱动它，但不会替你编辑场景或 prefab 结构。

## 安装

UnityRail 以两种可叠加的形式发布：原生桌面安装包，以及自包含的 `thinkrail` CLI。两者都随 `SHA256SUMS` 发布在 [releases 页面](https://github.com/JetBrains/thinkrail/releases)。

### 桌面版

下载适用于你平台的 `thinkrail-desktop-*` 资产：

- **macOS 14+（Apple Silicon 或 Intel）** —— 打开对应架构的 DMG：
  `thinkrail-desktop-darwin-arm64.dmg` 或 `thinkrail-desktop-darwin-x64.dmg`。
- **Windows x64** —— 解压完整的 setup ZIP，然后在其 payload 旁边就地运行 setup 可执行文件。
- **Linux x64 / ARM64** —— 解压 setup tarball 并运行 `installer`。桌面构建需要 glibc 2.38+ 以及 GTK 3、WebKitGTK 4.1、Ayatana AppIndicator 3 和 librsvg 2 —— Ubuntu 24.04 或更新版本：

  ```bash
  sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2
  ```

打包的 stable 和 nightly 桌面构建会在后台检查更新，并在 **设置 → 更新** 中提供：**下载** → **正在准备更新** → **安装并重启**。在你选择 **安装并重启** 之前不会应用任何内容。随后 UnityRail 会显示安装进度和日志，关闭并在新版本上重新打开；重启后会告知更新是否安装成功，失败时会解释原因并提供重试。仅当安装包带有有效的 HTTPS feed 标识时才会出现更新器；早于该标识的安装需要先手动安装一次。

### 命令行

安装脚本会下载正确的二进制、校验 SHA-256，并把 `thinkrail` 放进你的 PATH。

**macOS / Linux**（Windows 下 Git Bash 同样可用）：

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
```

**Windows** —— 在 cmd 和 PowerShell 中同样可用：

```powershell
powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"
```

然后运行 `thinkrail`，可选地跟一个 git 仓库路径作为项目打开：

```bash
thinkrail ~/code/my-repo
```

`thinkrail` 需要 PATH 中有 `git`，并需要一个模型供应商 —— 在应用中用 JetBrains AI 登录，或使用你自己的供应商凭据。首次启动会引导你连接供应商并选择项目；**Start a new project** 会创建一个空 git 仓库（默认在 `~/thinkrail` 下），因此无需提前准备。**添加项目 → 克隆仓库…** 会把 Git URL 克隆到运行 UnityRail 的电脑上的新文件夹并作为项目打开。选择父文件夹和文件夹名，可选地限制历史深度，或取消进行中的克隆。GitHub 及其他 Git 托管使用宿主机已有的 Git 凭据和 SSH 密钥；已存在的目标文件夹绝不会被覆盖。`thinkrail --help` 列出参数，`thinkrail --version` 打印构建版本。

<details>
<summary><strong>Nightly 构建、固定版本、更新与卸载</strong></summary>

安装脚本接受 `--channel stable|nightly` 和 `--version`；固定的版本必须属于所选通道：

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --channel nightly
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --channel stable --version 0.1.2
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --channel nightly --version 0.2.0-nightly.10
```

Windows 上这些选项是环境变量（`THINKRAIL_CHANNEL`、`THINKRAIL_VERSION`、`THINKRAIL_PREFIX`、`THINKRAIL_NO_MODIFY_PATH`）：

```powershell
$env:THINKRAIL_CHANNEL='nightly'; irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex   # PowerShell
set "THINKRAIL_CHANNEL=stable" && set "THINKRAIL_VERSION=0.1.2" && powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"   # cmd
```

已安装的 stable 和 nightly CLI 宿主会定期在 **设置 → 更新** 中提供 **运行更新**。它会在后台运行宿主机的 `thinkrail update` —— 即使 UI 开在另一台机器的浏览器中也是如此 —— 更新成功后要求你手动重启宿主。你也可以在任何平台直接运行 `thinkrail update`：它会为当前安装通道重新运行安装脚本，并替换 `<prefix>/bin/thinkrail[.exe]`；仅在需要显式覆盖时传 `--channel` 或 `--version`。

`thinkrail uninstall` 会删除可执行文件、安装脚本添加的 PATH 项和安装元数据，并询问是否删除你的 `~/.thinkrail` 应用状态（默认保留 —— `--remove-data` 删除，`-y` 跳过询问）。

更喜欢手动安装？从 releases 页面下载二进制和 `SHA256SUMS` 并校验。要让自更新生效，请把它重命名为 `thinkrail`（Windows 上为 `thinkrail.exe`）并放到 `<prefix>/bin/thinkrail[.exe]`；保留发布文件名或放在别处的二进制必须手动替换，或用脚本重装。

</details>

### 平台说明

| 平台 | 桌面版 | CLI |
| --- | --- | --- |
| macOS Apple Silicon / Intel | DMG | 已签名二进制 |
| Windows x64 | 已签名的 setup 可执行文件和 app 二进制 | 已签名 `.exe` |
| Linux x64 / ARM64 | setup tarball，未签名 | 未签名 |

JetBrains 会为 Windows CLI、桌面 setup 可执行文件，以及桌面应用安装的每个可执行文件和 DLL 签名。macOS CLI 已签名但尚未公证。已签名并公证的桌面 DMG 需要 JetBrains 协调的服务流水线；较早发布的 DMG 和本地构建的包可能仍未签名并被 Gatekeeper 拦截。Linux 产物未签名。

## 分析与隐私

UnityRail 应用会收集基本使用事件 —— 启动、创建聊天、发送消息、连接供应商 —— 并与随机安装 ID 关联。使用分析绝不包含提示词、代码、文件、凭据或账号身份。错误报告也会始终发送，并关联同一安装 ID，以便我们修复崩溃：错误类型、代码，以及它在 UnityRail 自身代码中的发生位置。它们绝不包含错误消息、文件路径、名称、URL，也不包含来自你的项目或扩展的任何内容。额外的产品使用情况和“你如何得知 UnityRail”仅在你开启 **共享更多使用数据** 时共享；该开关在首次运行设置中提供（或在你跳过它后立即提供），并位于 **设置 → 隐私**。从命令行启动时，`thinkrail --no-analytics`（或 `THINKRAIL_NO_ANALYTICS=1`）会在该次运行关闭额外共享。开启额外共享后，打包构建可能会在你的浏览器中打开一次 UnityRail 博客，把这次安装与带来你的网站访问关联 —— 仅在你于网站接受营销 Cookie 或无需同意的情况下 —— 该关联在 30 天后失效。

反馈问卷与使用分析相互独立。UnityRail 可能邀请你填写一份简短问卷，你也可以从 **设置 → 反馈** 打开。你的回答（包括你输入的任何内容）只有在你按下 **发送** 时才会发送给 UnityRail 团队，与你的分析设置无关，并关联同一随机安装 ID —— 而不是你的姓名或账号。请勿包含机密、代码或个人数据；如需删除回答，请发送邮件至 info@thinkrail.ai。

UnityRail 应用和 UnityRail 网站（[thinkrail.ai](https://thinkrail.ai)）使用 PostHog Inc. 的服务进行分析。网站还使用 PostHog Surveys 在桌面下载后收集反馈，并且仅在你选择填写时收集电子邮件地址，用于进一步反馈和发送产品更新。PostHog 的隐私政策见 [posthog.com/privacy](https://posthog.com/privacy)。

## 架构概览

UnityRail 是一个薄宿主：它在进程内运行 `pi`，并把它桥接给一个丰富的 Web UI。`pi` 拥有模型、技能、压缩、费用和会话状态；应用拥有工作区、编辑器和协议 —— 它绝不会在你背后拼装提示词。三个环：

- **引擎宿主** —— `packages/server`（+ `packages/shared`）：一个 `Bun.serve` HTTP+WS 宿主，每个聊天一个进程内 `pi` 会话，由 `apps/cli` 或 `apps/desktop` 启动。
- **协议** —— `packages/contracts`：宿主与 UI 之间带类型、带版本的协议。
- **UI 客户端** —— `apps/web`：React 19 + Zustand + Tailwind v4，独立发布；它通过协议连接宿主，只依赖 contracts。

[`goal-and-requirements.md`](goal-and-requirements.md) 与 [`architecture.md`](architecture.md) 是权威的产品和设计规格。UnityRail 采用规格先行：每个模块旁都有一份 `SPEC.md`，任何改变边界、契约或决策的改动都在同一次改动中更新规格。

## 开发 UnityRail

你需要 **Bun** 1.4.4（固定的包管理器和运行时）、**Node.js** ≥ 22.19（进程内 `pi` 引擎要求），以及一个已认证的 `pi` 供应商来处理智能体工作。

```bash
git clone https://github.com/JetBrains/thinkrail.git
cd thinkrail
bun install
bun run dev                          # 同时启动宿主和 Web 客户端；Ctrl+C 停止两者
```

```bash
bun run --filter @thinkrail/cli dev  # 浏览器启动器
bun run build:binary                 # 独立 CLI 产物
bun run desktop:dev                  # 打包并打开 Electrobun 应用
bun run desktop:build                # 只打包，不打开
```

[`CONTRIBUTING.md`](CONTRIBUTING.md) 涵盖各项检查、端到端测试套件、桌面打包和仓库布局。

## 贡献

欢迎贡献 —— 见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。本项目与社区受 [Code of Conduct](CODE_OF_CONDUCT.md) 约束。

## 社区

加入 [Discord](https://thinkrail.ai/discord) 提问、分享你在构建的东西，并与团队交流。Bug 和功能请求请提交到 [GitHub issues](https://github.com/JetBrains/thinkrail/issues)。

## 许可证

基于 [Apache License 2.0](LICENSE) 授权。
