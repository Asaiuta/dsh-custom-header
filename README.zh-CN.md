# dsh-custom-header

**DeepSeek Harness（DSH）出站 LLM 请求修改插件，工作在 fetch 传输层。**

一条 `globalThis.fetch` 中间件链（挂在 DSH 专用 symbol
`Symbol.for("dsh-custom-header.fetch.pipeline.v1")` 上），所有 provider——
无论归哪个插件持有——的请求都从这条链上流过：

- **注入**客户端身份头（`User-Agent`、`Originator`、`X-Claude-Code-Session-Id`、
  `x-opencode-*` 等），预设头集仿照真实 Codex / Claude Code / opencode 客户端
- **剥离** `X-Stainless-*` 运行时指纹头
- **重写**请求 URL（路径匹配 + `appendQuery`）
- **补丁**请求体：Anthropic Messages 的 identity / billing system 块 +
  `metadata.user_id`，以及 opencode Zen 免费层的工具桩

> 仅用于你有权管理的服务器或已授权环境。Cloudflare 的 TLS/Bot 边缘拦截
> 需要不同的 API 入口、管理员白名单或本地正向代理。

## 为什么回到 fetch，而不是持有 provider 的适配器

0.2 / 0.3 曾把本插件改写成通过 `ctx.llm.registerAdapter(routes, adapter)`
注册的、**持有 provider 路由的 `LlmAdapter`**。那个扩展点是**按路由独占**的：
注册一条已被别的插件持有的路由（比如 `llm-pi-ai` 注册的
`ziyong`/`moonshotai`），会直接抛 `DUPLICATE_ADAPTER`，而宿主没有提供任何
「嫁接」到别人适配器上的通道。而本插件的意图恰恰是「让我发往自己网关的请求
看起来像客户端 X」——无论这些请求来自哪个插件——所以它需要的是一个不持有任何
路由的席位。fetch 层就是那个席位：它拦在传输层，而所有适配器本来就都走传输层。

fetch 席位的代价是：识别一个请求只能靠 URL（永远看不到它是哪个 provider 发的）。
因此 `gatewayHosts` 白名单成为唯一的安全边界：**所有预设——包括固定预设——都只作用于
命中白名单主机的请求**，白名单为空即完全无操作。

## 工作机制

`apply` 向共享管道注册四个中间件，每个都按需重读一份快照，而快照由
`loader/volatile-update` 刷新（所以设置页保存的修改对下一次请求即生效，无需重启）：

| 优先级 | 中间件 | 做什么 |
|---|---|---|
| 5 | `url-rewrite` | 路径匹配 + `appendQuery` / 替换，按主机门控 |
| 6 | `header-strip` | 按预设要求剥离 `X-Stainless-*` 与运行时指纹头 |
| 7 | `header-inject` | 注入解析出的预设身份头 + `extraHeaders` |
| 8 | `body-patch` | Anthropic 身份 body 补丁；opencode Zen `/zen` → `/inference` + `bash`/`read` 工具桩（仅免费模型） |

链条机制：`globalThis` 上一个访问器形式的 `fetch`，其 setter 保持底层 fetch
同步；中间件在每次（重）安装时按优先级升序组合；每个中间件收到
`{ input, init, next }`，可以用改写过的 input 调 `next`。管道 vendored 自
[`@aizigao/pi-fetch-pipeline`](https://github.com/aizigao/pi-fetch-pipeline)
（MIT），重新定了 DSH 专用 key，使多个插件能在同一进程共存而不互相踩链。

会话级 id（`x-opencode-session`、`X-Claude-Code-Session-Id`、`metadata.user_id`）
没法从 URL 里读出来，所以插件包装了 `llm/stream` 瀑布：每次适配器流迭代——
包括它发出的 fetch——都运行在携带 `GenerateOptions.sessionId` 的
`AsyncLocalStorage` 里。这正是并发 DSH 对话不会共享同一个进程级 id 的原因。
同一个观察器还会在 403 时输出诊断，区分 Cloudflare HTML 边缘拦截与 JSON
客户端限制拒绝。

配置是插件上的 schemastery `Config` schema，由 Loader 依据 `cordis.yml` 校验。
**每个字段都标了 `.volatile()`**——这正是 `dsh-settings` 会为这个 entry 发布
可写命名空间的前提：它的 `describe()` 只收录带 volatile 字段的条目，写入器
拒绝其它路径。volatile-only 变更被提交进正在运行的 fiber 而不重新挂载——
宿主半程在 `loader/volatile-update` 时重读各 ref，而不是在挂载时做快照。

配置页本身是插件自带的浏览器半程（`src/client/*`）。它注册为**设置面板的一个
分节**（`settings.section`），并作为第二席位挂在插件页里本 bundle 自己那一行
（`plugins.row.config`）——见下文 **配置页**。

| 关注点 | 位置 |
|---|---|
| 中间件注册 + 诊断 | `index.ts` |
| fetch 管道（vendored，symbol 键控） | `fetch-pipeline.ts` |
| 头注入 / 剥离 | `header-inject.ts` |
| 预设解析 + 预设定义 | `profiles.ts` |
| Anthropic body 补丁 + Zen 免费层接线 | `body-patch.ts` |
| opencode Zen 助手 | `opencode-zen.ts` |
| URL 重写 | `url-rewrite.ts` |
| 按对话隔离的会话 id | `session-context.ts`（AsyncLocalStorage） |
| 403 诊断 | `index.ts` + `response-hints.ts` |
| 设置 schema（全部 volatile） | `config.ts`（`ConfigSchema`，schemastery） |
| 配置页 | `client/index.tsx`（`settings.section` + `plugins.row.config`） |
| 场景选择器（意图 → 暂存 `profile`） | `client/scenarios.ts` |
| 页面文案（中 / 英） | `client/locales.ts` |
| 页面控件 + 字段规格 | `client/fields.tsx` |
| 页面样式表 | `client/styles.ts` |

安全默认：`profile: "off"`，或 `gatewayHosts` 为空——两种情况都什么都不做：
不注入、不剥离、不重写、不补丁。

## 预设（profiles）

每个固定预设是一整套完整的客户端身份头：

| Profile | 发送的头 |
|---|---|
| `codex_desktop` | `codex_app/1.2026.0628 (Windows NT 10.0; Win64; x64)` + `Originator: codex_app` |
| `codex_official` | `codex_cli_rs/0.147.0 (Windows 10.0.19045; x86_64) WindowsTerminal` + `Originator: codex_cli_rs` |
| `codex_tui` | `codex-tui/0.147.0 (…; x86_64) WindowsTerminal` + `Originator: codex-tui` |
| `codex_claude_plugin` | `Claude Code/0.5.0 (Macos 15.5; arm64) iTerm2.app` + `Originator: Claude Code` |
| `pi_agent` | `pi-coding-agent/1.0` + `Originator: pi`（需要服务器侧同时放行该身份） |
| `claude_code_messages` | `claude-cli/2.1.220 (external, sdk-cli)` + `X-Claude-Code-Session-Id` + 完整 `anthropic-beta` + body（JSON `user_id` / system 块） |
| `opencode_zen` | `opencode/1.19.0 ai-sdk/...` UA + `x-opencode-client/project/session/session-id/request`（`ses_` 降序 id） |
| `auto` | 命中主机时：Anthropic `/v1/messages` 路径 → Claude 头集；其余 → `codexFallback` |
| `off` | 不修改 |

所有预设——包括固定预设——都受 `gatewayHosts` 门控。Codex 头值已对照
openai/codex 开源源码验证（见下文「真实性核对」）；opencode 的 `Identifier`
id 方案（`msg_` 升序 / `ses_` 降序，`hex12` + base62）与 Claude Code 2.1.220
头集按真实格式重建。

## 真实性核对（Codex 预设）

Codex 身份字段逐项对照一手来源：

- **`Originator: codex_cli_rs`** —— openai/codex 源码实锤：
  `codex-rs/login/src/auth/default_client.rs` 中
  `DEFAULT_ORIGINATOR = "codex_cli_rs"`（另有 codex-tui / codex_vscode）。
- **codex_official 的 UA 构造** —— 同文件 `get_codex_user_agent()`：
  `{originator}/{版本} ({os_type} {os_version}; {arch}) {终端token}`，终端
  token 来自 `codex-rs/terminal-detection/src/lib.rs`（Windows Terminal →
  `WindowsTerminal`，TERM 环境 → `xterm-256color` 等）。写死的 `terminal`
  尾部不存在于任何真实 Codex 构建，已替换。版本为当前最新 `0.147.0`
  （rust-v0.147.0，2026-08-07 发布）。
- **codex_cli_rs 与 codex-tui 的区分** —— CLI 有多个第一方前端，交互式
  `codex` 会话实际发 `codex-tui/…` UA + `Originator: codex-tui`；预设
  `codex_official`（headless/默认）与 `codex_tui`（交互 TUI）覆盖两种形态。
- **`codex_app/` + `Originator: codex_app`** —— 桌面壳闭源；完整 UA 为实测值，
  可用 `codexDesktopVersion` 覆盖。
- **codex_claude_plugin** —— Claude Code UA 格式，`0.5.0` 是真实旧版本；
  服务端只匹配前缀，保守取值。

## 安装

```bash
# 在插件仓库目录（装完重启 dsh web）
dsh plugin --profile web add file:$(pwd)

# 或发布到 npm 后：
dsh plugin add dsh-custom-header
```

验证：观察 DSH 服务器日志里的 `dsh-custom-header loaded: ...` 诊断行，或
调用 `ctx.dshCustomHeader.status()`。

## 配置

`cordis.yml` 的插件节（所有字段可选）：

```yaml
dsh-custom-header:
  profile: auto             # auto | off | codex_desktop | codex_official | codex_tui | codex_claude_plugin | pi_agent | claude_code_messages | opencode_zen
  gatewayHosts:
    - gateway.example.com   # 白名单：所有预设都只碰这些主机；子域自动匹配；留空 = 无操作
  codexFallback: codex_desktop
  codexCliVersion: 0.147.0
  codexDesktopVersion: 1.2026.0628
  claudeCliVersion: 2.1.220
  # anthropicBeta: "claude-code-20250219,interleaved-thinking-2025-05-14,…"  # anthropic-beta 头（claude_code_messages）
  opencodeVersion: 1.19.0
  opencodeClient: cli
  opencodeProject: global
  # opencode Zen 免费层（需 profile: opencode_zen 且命中免费模型）：
  opencodeZenFree: false        # /zen → /inference + bash/read 工具桩
  claudeSystemBlock: identity    # identity | billing
  extraHeaders: {}              # 合并到所有 profile 之上
  urlRewrites:
    /v1/messages:
      appendQuery: beta=true    # 服务端严格校验 ?beta=true 时
```

provider 自身的 base URL 照常指向网关即可——本插件从不碰 provider 配置，
它拦截的是 provider 发出的请求。

## 配置页

页面是**设置面板里的一个分节**：*设置 → 请求头修改*，与「通用 / 模型 / 插件」
并列的独立导航行，注册进 `settings.section` 槽。

页面是左侧导航栏 + 三个稳定页面（外壳布局参考 `dsh-any-background` 的设置分节）。
每个字段都有唯一固定的归属页，切换页面不会重新归类任何一行——「正在编辑的行突然
跳走」正是这次改版要消灭的怪现象：

| 页面 | 字段 |
| --- | --- |
| 身份与网关 | `gatewayHosts`、`codexFallback`、`claudeSystemBlock` |
| 版本与请求头 | `claudeCliVersion`、`codexCliVersion`、`codexDesktopVersion`、`anthropicBeta`、`opencodeVersion`、`opencodeClient`、`opencodeProject`、`opencodeZenFree` |
| 高级 | `extraHeaders`、`urlRewrites` |

「身份与网关」页顶部是**场景选择器**，不是字段清单。准确的字段名描述的是**配置**，
描述不了**意图**：没人是为了设置 `gatewayHosts` 来的，是为了让 **Codex / Claude
Code / opencode / pi** 连上自己的网关。每个 tab 就是一种意图，选中它会暂存一个
`profile`，让这个意图成为事实：

| 场景 | 暂存 `profile` |
| --- | --- |
| 自动 | `auto` |
| Codex | `codex_official` / `codex_tui` / `codex_desktop` / `codex_claude_plugin`（二级选择） |
| Claude | `claude_code_messages` |
| pi | `pi_agent` |
| opencode | `opencode_zen` |
| 关闭 | `off` |

只有当前页面的字段会被渲染，所以每个字段在页面上只挂载一次，每个控件的 DOM id
保持唯一。

### 控件

每个字段按它自己的形状分配宿主控件：

| 字段形状 | 控件 | |
| --- | --- | --- |
| 单行文本 | `SettingsValueField` | 自带 label、已覆盖徽标、恢复默认、无效文案和 `help` 区 |
| 2–4 个取值 | `SegmentedControl` | `claudeSystemBlock`、`codexFallback`、Codex 变体 |
| 布尔 | `Switch` | `opencodeZenFree` |
| 字符串列表 / JSON | `textarea` | 本页自己的——宿主没有多行行组件 |

长解释放在每行的 **?** 按钮后面而不是底下，这正是常驻的 `hint` 能保持一行以内的原因。

同一份表单还注册了第二个席位：**插件页**上本 bundle 自己那一行（*插件 →
dsh-custom-header* 该行的「配置」控件），走 `plugins.row.config`。那是宿主槽契约
给第三方 *bundle* 配置安置的位置；而设置分节才是用户真正会去找它的地方。

边打字不会边写盘：页面先暂存草稿，**保存** 是唯一会改动设置文档的动作，
并以修订号对别处的并发改动做栅栏。选场景也是一次暂存编辑，遵循同一规则——保存才落盘，
放弃可回退。保存落到 profile 补丁，对下一次请求即生效——无需重启。

如果你要动这块代码，有四条宿主契约的推论值得知道：

- **宿主半侧只能具名导出 —— 绝对不能 `export default`。** Loader 用
  `unwrapExports`（`cordis-plugin-loader/lib/index.js`）取插件模块，它优先
  `default` 而非命名空间：

  ```js
  exports = exports.default ?? exports      // default 会「顶替」命名空间
  if (!exports.__esModule) return exports
  return exports.default ?? exports
  ```

  于是 `export default apply` 交给注册表的是一个裸函数：`fiber.runtime` **就是**
  那个函数，因而 `fiber.runtime.Config` 是 `undefined`。而 `dsh-settings` 正是从
  那里取 schema（`schema(entry) { const schema = entry.fiber?.runtime?.Config; … }`），
  取不到就 `return []` —— **命名空间永不发布**。症状极具误导性：插件照常加载、
  客户端半侧的导航行照常出现、所有日志都是干净的，只有页面正文写着
  「本主机未提供这份配置。」——读起来像客户端的 bug。官方宿主半侧全部只用具名
  导出（`dsh-client-ui-settings` → `export { Config, apply }`；`dsh-ops` 同样），
  本插件也是如此。`build.mjs` 每次构建后都会断言产物里没有 default 导出。
- 插件 **不需要** `plugins.item` 条目。那个槽被官方设置页占着；第三方 bundle
  的配置属于 `plugins.bundle.config` 或 `plugins.row.config`，按 bundle 的包名
  作键（这里是 `<包名>#<行 id>` = `dsh-custom-header#dsh-custom-header`）。
- `settings.section` 的导航身份写在注册选项里：`id`（必填——新的 id 会加在
  内建行旁边，复用它们的则会顶掉那一行）、`order`（升序位置；内建行分别在
  −10/0/10/15/20，`dsh-market` 在 40，所以这里取 50）、`label`（thunk，
  每次投影都重读，因而跟随语言切换）。设置的内容列**不会**给分节画标题，
  所以页面自带标题。
- `.volatile()` 字段才是让该条目出现在设置平面上的原因；去掉标记，页面会
  **静默消失**。

```js
// 任意插件 / 脚本里：
ctx.dshCustomHeader.setProfile('codex_desktop')   // 程序化运行时切换
ctx.dshCustomHeader.status()                      // 诊断快照
```

## 已知残留与限制

- **`accept-language` / `sec-fetch-mode`**：由 Node undici 在 fetch 之下注入，
  拦截层无法剥离。多数服务端只看 UA + 自定义头，实践中够用；若服务端
  校验到这一层，需要本机反代出网前剥离。
- **Anthropic `?beta=true`**：通过 `urlRewrites.appendQuery` 解决，无需反代。
- **Cloudflare 拦截**：HTML 边缘响应无法靠改请求头解决；需换 API 入口、
  管理员白名单或本机转发。`llm/stream` 观察器会在日志中区分 CF HTML 与
  JSON 拒绝响应。
- **opencode Zen 免费层**：仅靠伪造请求头已不够。在 `profile: opencode_zen`
  且 `opencodeZenFree: true` 并命中免费模型（`*-free` / `big-pickle` /
  `grok-code`）时，body-patch 中间件会把 `/zen`
  改写到 `/inference` 并提供 `bash`/`read` 工具桩（Zen 现在要求的）。
  模型 id 是从请求体里读的——这正是 URL 改写住在该中间件而不是
  `url-rewrite.ts` 的原因。
- **请求体补丁需要可重读的 body**：body-patch 中间件会缓冲 JSON 请求体
  （并重算 `content-length`）；非 JSON 或流式的请求体原样放行。

## 开发

```bash
npm install
npm run typecheck   # tsc 对着 stubs/ 检查，不是 node_modules —— 见下
npm run build       # esbuild → lib/index.js + lib/client.js；tsc → lib/types（声明文件）
npm run check       # typecheck + build
node tests/smoke.mjs  # 本地假网关；9 场景 31 断言
```

`tests/smoke.mjs` 也支持在不碰 `lib/` 的情况下测一个构建产物（桌面端在跑、
插件被挂载监视时很有用）：

```bash
npx esbuild src/index.ts --bundle --format=esm --platform=node --target=node22 \
  --external:@deepseek-ai/cordis --external:@deepseek-ai/dsh-* \
  --outfile=%TEMP%/dch-smoke/index.js
set SMOKE_LIB=%TEMP%/dch-smoke/index.js && node tests/smoke.mjs
```

`@deepseek-ai/*` 实际从**另外两个地方**来，所以 `node_modules/` 里那份从来不是
起作用的那份：

- **类型** —— `tsconfig.json` 把 `@deepseek-ai/*` 映射到 `stubs/@deepseek-ai/*`。
  那些桩故意写得极宽松（`declare const z: { [key: string]: any }`），因此
  `npm run typecheck` 校验的是**本仓库的代码**，不是宿主 API 面。所以本地装了
  旧版本不会拖垮构建；反过来，类型检查全绿也**不证明**宿主运行时支持你调用的
  东西。
- **运行时** —— `build.mjs` 把 `@deepseek-ai/dsh-*` 与 `@deepseek-ai/cordis`
  保持 external，插件拿到的是**宿主**的那份，不是本仓库的。这一点是实测而非
  推断：`@deepseek-ai/schemastery@3.18.1` 根本没有 `volatile` 这个成员
  （`typeof z.string().volatile === 'undefined'`），而 `config.ts` 里每个字段
  都在调 `.volatile()`，插件却加载得好好的。宿主手里的版本是：

  | specifier | 宿主放在哪 |
  | --- | --- |
  | `@deepseek-ai/cordis` | `app.asar` → **4.0.5-alpha.1** |
  | `@deepseek-ai/dsh-llm` | `app.asar` → **0.2.1-alpha.2** |
  | `@deepseek-ai/schemastery` | `app.asar` → **3.18.5-alpha.1**，另外 `profiles/<名字>/node_modules` → **3.18.4** |

  两份 schemastery 都有 `.volatile()`，本仓库那份没有。所以你能依赖的 API 面
  是宿主的，并且随宿主漂移——需要时去探它，别信本地安装。反过来，任何直接
  import `lib/index.js` 的做法（离线自检之类）会撞上相反的问题：裸
  `@deepseek-ai/*` 解析到**本仓库**那份陈旧副本，失败原因与代码本身毫无关系。
  这类脚本要先把这些 specifier 重定向到宿主副本。

## 许可

MIT。客户端身份预设镜像自公开文档化的上游格式，未 vendor 任何第三方源码。
fetch 管道 vendored 自 `@aizigao/pi-fetch-pipeline`（MIT），重新定了 DSH 专用 key。
