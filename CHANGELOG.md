# Changelog

## 0.4.0 (2026-10-16)

- **传输层回到 fetch 中间件管道。** 0.2.0 把插件改成了持有 provider 路由的
  原生 `LlmAdapter`（`ctx.llm.registerAdapter`），但那个扩展点是**按路由独占**的：
  想给已被别的插件持有的 provider（如 `llm-pi-ai` 的 `ziyong`/`moonshotai`）
  注入客户端签名，注册直接抛 `DUPLICATE_ADAPTER`，宿主也没有「嫁接」到别人
  适配器上的通道；`llm/stream` 瀑布又改不了 HTTP 头。本插件的意图恰恰是
  「让我发往自己网关的请求看起来像客户端 X」——无论这些请求来自哪个插件——
  所以回到不持有任何路由的 fetch 层：`globalThis.fetch` 上一条 DSH 专用
  symbol 键控（`Symbol.for("dsh-custom-header.fetch.pipeline.v1")`）的中间件链，
  所有 provider 的请求都从链上流过。**这不是回退到 0.1.3**：0.3.0 的设置平面
  （`ConfigSchema` 全 volatile、场景向导配置页、无 default 导出修复、lockfile
  修复）全部保留，只换传输实现。
- 四个中间件（优先级升序）：`url-rewrite`(5) → `header-strip`(6) →
  `header-inject`(7) → `body-patch`(8)。每个都按需重读一份快照，快照由
  `loader/volatile-update` 刷新——设置页保存对下一次请求即生效，不重挂插件。
- **统一主机门控（行为变更）**：fetch 层识别请求只能靠 URL，永远看不到它属于
  哪个 provider，因此 `gatewayHosts` 成为**唯一的安全边界**——所有预设（包括
  `codex_official` 等固定预设，0.1.x 里它们全局注入）都只作用于命中白名单
  主机的请求；白名单为空即完全无操作。`resolveProfileForUrl` 统一实现该规则。
- **配置面收窄**：删除适配器时代字段 `providers` / `openaiProviders` /
  `baseUrl` / `openaiBaseUrl` / `apiKey`（provider 路由不再由本插件持有，网关
  URL 由 provider 自身配置决定）。`gatewayHosts` 从「仅 auto 生效」升格为中心开关。
- 会话 id 恢复按对话隔离：`llm/stream` 包装器把 `GenerateOptions.sessionId`
  经 AsyncLocalStorage 传给 fetch 层（`session-context.ts` 回归）；
  `x-opencode-session` / `X-Claude-Code-Session-Id` / body `metadata.user_id`
  均按会话惰性分配缓存，非 LLM 请求退回进程级 default 会话。
- opencode Zen 免费层移植到 fetch 层：`body-patch` 中间件先读请求体里的
  模型 id，命中免费模型（`*-free` / `big-pickle` / `grok-code`）时把 `/zen`
  改写到 `/inference` 并补 `bash`/`read` 工具桩——URL 改写住在 body-patch
  而不是 url-rewrite，正因为判定需要模型 id。
- **删除 `opencodeFreeModels`**（额外免费模型 id 列表）：实际用不上，0.4.0
  未发布、无兼容负担；`isOpencodeFreeModel` 改为只认内置免费 id。
- 403 诊断保留：`llm/stream` 观察器区分 Cloudflare HTML 边缘拦截与 JSON
  `client_restriction` 拒绝。
- 代码组织：恢复 `fetch-pipeline.ts` / `session-context.ts` /
  `header-inject.ts`；重写 `url-rewrite.ts`（新增 `UrlRewriteContext` /
  `withUrl` 等）与 `body-patch.ts`（新增 `createBodyPatchMiddleware`，保留
  `patchAnthropicMessagesPayload`）；删除 `adapter.ts` / `adapter-common.ts` /
  `adapter-openai.ts` / `serialize.ts` / `serialize-openai.ts` / `sse.ts` /
  `sse-openai.ts`。
- **字段改名（按日常读法）**：`autoHosts` → `gatewayHosts`（网关主机）、
  `autoCodexProfile` → `codexFallback`（Codex 兜底）、`claudeSystemMode` →
  `claudeSystemBlock`、`codexVersion` → `codexCliVersion`；配置页为
  `opencodeClient` / `opencodeProject` 补上专属提示（原来错用版本提示）。
  0.4.0 未发布过，未做旧名兼容。
- **配置页重排为「导航栏 + 三个固定页」**（外壳参考 `dsh-any-background` 的
  设置分节：左侧 158px 导航栏与滑动指示条、品牌块、页面切换动画、卡片；
  ≤620px 收成顶部横条）。起因是场景向导的一个真实缺陷：字段按 `overridden`
  分区（「也已设置，但不属于当前场景」），而 `overridden` 在**暂存**时就为真，
  于是编辑 `claudeSystemBlock` 这类当前场景不列的字段时，正在编辑的行会从
  「全部设置」折叠区**跳到页外**——行在手下跑掉。新布局里每个字段有唯一
  归属页，切页不再重新归类任何行：
  1. **身份与网关**（`gatewayHosts` / `codexFallback` / `claudeSystemBlock`）——
     顶部仍是场景选择器，选中场景**只**暂存 `profile`；
  2. **版本与请求头**（8 个版本/头字段）；
  3. **高级**（`extraHeaders` / `urlRewrites`）。
  随之删除 `scenarios.ts` 的 `fields` / `ScenarioFields` / `scenarioFields`、
  `fields.tsx` 的 `GROUPS` 导出与「也已设置」分区；`styles.ts` 与
  `index.tsx` 按新外壳重写（导出 `NAV_ITEM_H` / `NAV_GAP` 供指示条定位），
  `locales.ts`（中英）新增 `brandTag` / `nav*` / `overline*` / `desc*` 并清掉
  死键。
- 配置页随配置面同步：删除网关端点分组与 `apiKey` 密钥行（连带
  `SettingsSecretField` 用法与 secret 字段类型）；`fields.tsx` /
  `scenarios.ts` / `locales.ts`（中英）同步。
- 冒烟测试回归并扩展：`tests/smoke.mjs` 9 场景 31 断言（新增「固定预设同样
  受 `gatewayHosts` 门控」）；支持 `SMOKE_LIB` 环境变量指向临时构建产物，
  便于在桌面端运行（插件被挂载监视）时不碰 `lib/` 验证构建。
- README（中 / 英）重写「为什么回到 fetch / 工作机制 / 配置 / 配置页 /
  已知残留」章节。

## 0.3.0 (2026-10-16)

- **配置页改为场景向导。** 原来一屏铺开 20 个控件——那是对**配置**的准确描述，却是对
  **意图**的糟糕描述：没人是为了设置 `providers` 来的，是为了让 **Codex / Claude Code /
  opencode / pi** 连上自己的网关。页面现在按「先宽后窄」分层：
  1. **场景选择器**（`SegmentedTabs`，6 个 tab：自动 / Codex / Claude / pi / opencode / 关闭）。
     选中一个场景 = **暂存**一个 `profile` 值——所以场景是实的，不是装饰。
  2. **该场景的字段**（2–6 个）。
  3. **也已设置、但不属于当前场景的字段**——否则选了场景会把已存的配置**藏起来**，读起来像丢数据。
  4. **共享字段**（`extraHeaders` / `urlRewrites`）折叠区：它们对每个场景都生效，所以不属于任何一个。
  5. **全部设置**折叠区：上面没渲染过的剩余字段。**每个字段在页面上只渲染一次**——这同时保证了控件 DOM 唯一。
  - 场景选择与打字一样是暂存：只有**保存**落盘，**放弃**可回退，绝不即时写。
  - 顺带修掉一个隐患：原来「网关端点」「客户端身份」等分组的字段在全部设置区会**重复渲染**，
    导致同一 DOM id 出现两次；现在用「已渲染集合」求差集杜绝。
- **枚举/布尔/密钥改用宿主现成控件。** 之前 `profile`（9 取值）、`autoCodexProfile`（4）、
  `claudeSystemMode`（2）、`opencodeZenFree`（`true`/`false`）全是**纯文本框**，`apiKey` 还是明文——
  等于让人手打 `codex_tui` 和 `true`。而宿主 `@deepseek-ai/dsh-client-ui-primitives` 早就给了整套：
  现在按字段形状分配 —— 单行文本 → `SettingsValueField`、密钥 → `SettingsSecretField`、
  2–4 个取值 → `SegmentedControl`、布尔 → `Switch`、字符串列表 / JSON → 仍是本页自己的 textarea
  （宿主没有多行行组件，`SettingsValueField` 的 `type` 写死为 `text`）。
  前两个自带**整行**结构（label / 已覆盖徽标 / 恢复默认 / 无效文案 / 「?」help 区），因此直接透传、
  继承宿主的 DOM 与 ARIA。
- **长说明收进「?」。** 取值清单、示例、注意事项从「每行底下的小字」移到 `SettingsValueField`
  的 `help` 区（点「?」展开）。这正是页面能保持紧凑的原因：解释一个字没少，只是不再常驻。
  例如 `profile` 那条原本 90 字、其中 60 字是取值枚举——枚举在换成分段控件后本来就不需要了。
- `providers` / `openaiProviders` **保持手填**，但在 help 里写清「provider id 是什么、从哪来」。
  ⚠️ 查证结论：**做不成选择器**。客户端远程 API 全表里没有 `llm.*` 命名空间，唯一像样的
  `session.modelCatalog()` 是**会话作用域**（设置页没有会话），`settings.describe` 只返回带
  volatile 字段的命名空间（provider 列表那种静态配置不在其中），`llm/adapters-updated` 只是事件、
  没有初值。绕路（借一个用户的会话去调 `modelCatalog`）会在那个会话上触发凭据解析与网络探活，不做。
- **修正：`profile` 不再有独立输入行**（避免与场景选择器互相矛盾），但仍在字段表里
  （新增 `hidden` 类型）：`SettingsFormModel` 只认得构造时传入的 spec，而场景选择器要暂存 `profile`。
  当前值以 `当前暂存的 profile： <id>` 回显。
- 新增**浏览器半侧的类型桩声明**（`SettingsValueField` / `SettingsSecretField` / `SegmentedControl` /
  `SegmentedTabs` / `Switch` / `DisclosureRow`），签名照 0.2.1-alpha.2 的产物抄录。
- 新增**浏览器半侧配置页**，注册为**设置面板的一个分节**
  （`settings.section`，`id: dsh-custom-header`、`order: 50`、`label` 为 thunk），
  与「通用 / 模型 / 插件」并列出现在 *设置* 的导航里。
  同一份表单另注册一个席位：插件页上本 bundle 自己那一行
  （`plugins.row.config`，键 `dsh-custom-header#dsh-custom-header`）。
  页面分四组共 20 个控件：
  网关端点（`providers` / `baseUrl` / `openaiProviders` / `openaiBaseUrl`）、
  客户端身份（`profile` / `autoCodexProfile` / `autoHosts` /
  `claudeSystemMode` / `apiKey`）、版本头（`claudeCliVersion` /
  `codexVersion` / `codexDesktopVersion` / `anthropicBeta` /
  `opencodeVersion` / `opencodeClient` / `opencodeProject` /
  `opencodeFreeModels` / `opencodeZenFree`）、高级（`extraHeaders` /
  `urlRewrites`）。设置的内容列不给分节画标题，故页面自带标题与说明。
- 分节注册**不**经 `configForms.whileServed`：命名空间是本 bundle 自己的行、
  必然存在，无条件注册可以让"宿主没能提供它"表现为页面的 `unavailable` 态，
  而不是让整个条目消失——可诊断的失败优于静默的失败。
  （`plugins.row.config` 那一席仍保留 `whileServed`，因为它是官方页面的通行做法。）
- **草稿式保存**：页面只暂存草稿，按「保存」才改动设置文档，并以修订号对
  并发改动做栅栏。保存落到 profile 补丁，经 `loader/volatile-update` 对
  **下一次请求即生效**（日志 `[dsh-custom-header] config updated live: …`），
  **不重挂插件**。
- `ConfigSchema` 的**每个字段都标注 `.volatile()`** —— 这是 `dsh-settings`
  为该 entry 发布可写命名空间的前提（其 `describe()` 只收录带 volatile 字段
  的条目，写入器拒绝其它路径）。去掉标记会让配置页静默消失。
- **修复：去掉宿主半侧的 `export default`。** Loader 用 `unwrapExports` 取插件对象，
  它优先 `default`（`exports = exports.default ?? exports`），所以 `default` 会**顶替**
  模块命名空间。原来那句 `export default apply` 让 `entry.fiber.runtime` 变成裸函数，
  `fiber.runtime.Config` 因此是 `undefined`；而 `dsh-settings` 正是从那里取 schema
  （`schema(entry) { const schema = entry.fiber?.runtime?.Config; … }`），拿不到就
  `return []`——**命名空间永不发布**。症状具有误导性：插件照常加载、客户端半侧的
  设置分节照常出现在导航里，只有页面内容是「本主机未提供这份配置。」
  （`--dump-config-schema` 里该条目早就显示 `status: "absent"`，当时被误判成工具假象。）
  现在只保留具名导出（`apply` / `inject` / `name` / `Config`），与官方宿主半侧一致
  （`dsh-client-ui-settings` 是 `export { Config, apply }`，`dsh-ops` 同样无 default）。
  `build.mjs` 每次构建后断言产物里没有 default 导出，防止这类回归再次静默发生。
- **修复：`npm install` 无法完成。** devDependency `@deepseek-ai/cordis` 钉的是
  `4.0.1`，而 `@deepseek-ai/dsh-llm@0.2.0-rc.2` 的 peer 要求 `~4.0.4`，任何一次
  全新安装都会 `ERESOLVE` 直接失败（本机 `node_modules` 因此长期停留在陈旧状态，
  `package-lock.json` 里 `schemastery` 记的还是 `3.18.1`，与 `package.json` 声明的
  `3.18.4` 不一致——那会让 `npm ci` 拒绝安装）。已把 `cordis` 提到 `4.0.4` 并重新
  生成 lockfile。产物**逐字节未变**（`@deepseek-ai/*` 全部 external，版本改动不
  参与打包）。
- 文档：README 增补**第四条宿主契约**（宿主半侧禁止 `default` 导出，见上）与
  「`@deepseek-ai/*` 的两个真实来源」——类型来自 `stubs/`（故 `typecheck` 不校验
  宿主 API 面），运行时来自宿主（`app.asar` 内 cordis `4.0.5-alpha.1` /
  dsh-llm `0.2.1-alpha.2` / schemastery `3.18.5-alpha.1`，profile 内另有
  schemastery `3.18.4`），本仓库自己那份 `node_modules` 在两条链上都不起作用。
- 页面样式表由客户端半侧注入（`<style id="dsh-custom-header-styles">`）；
  类名与设计令牌对齐官方设置表单，并对官方也没定义的令牌
  （`--dsw-font-mono`、`--dsw-alias-bg-layer-4`）提供 fallback。
- 构建升级为**双产物**：宿主 ESM（`lib/index.js`）+ 浏览器 CJS
  （`lib/client.js`，`window.__ModuleLoader__.load({ id, factory })` 包装）；
  `package.json` 新增 `exports["./client"]` 与 `dsh.client`
  （`platform: "web"`）。客户端半侧只 `require` 宿主静态模块表内的包
  （`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` 等），
  其余全部打进 bundle。

## 0.2.0 (2026-10-15)

- 从 fetch 中间件管道（`Symbol.for("dsh-custom-header.fetch.pipeline.v1")`，
  形状仿 `@aizigao/pi-fetch-pipeline`）改为**持有 provider 路由的原生
  `LlmAdapter`**，经 `ctx.llm.registerAdapter(providers, adapter)` 注册：
  所有修改在请求内部完成，**不再 monkeypatch `globalThis.fetch`**。
- 两个适配器：`AnthropicMessagesAdapter`（POST `/v1/messages`，吃 `providers`）
  与**新增**的 `OpenAIChatAdapter`（POST `/v1/chat/completions`，吃新增的
  `openaiProviders` / `openaiBaseUrl`）。
- 会话 id（`x-opencode-session`、`X-Claude-Code-Session-Id`、body
  `metadata.user_id`）改为在 `generate()` 内直接读
  `GenerateOptions.sessionId` 原生按对话隔离；删除 AsyncLocalStorage 桥接
  （`src/session-context.ts`）。
- **移除 Typert Remote 设置通道**：删除 `src/typert.ts`、`src/contract.ts`、
  `src/client/remote.ts`、`src/client/settings-tab.tsx`、`src/client/face.ts`；
  设置改由 schemastery `Config` + profile 补丁承载（`src/settings.ts`、
  `src/store.ts` 及 `$DSH_HOME/plugins/dsh-custom-header.json` 运行时持久化
  一并移除）。peer 依赖去掉 `dsh-typert-protocol` / `dsh-typert-registry`，
  `zod` 依赖移除；`react` 从 peer 降为 devDependency（客户端半侧打进 bundle，
  运行期由宿主静态模块表提供）。
- 新增 `src/opencode-zen.ts`：Zen 免费层 `/zen` → `/inference` 改写 +
  `bash`/`read` 工具桩。
- 新增 OpenAI 侧协议实现：`src/serialize-openai.ts`、`src/sse-openai.ts`。
- README（中 / 英）重写「工作机制 / 预设 / 真实性核对」章节。

### 已知残留

- 0.1.x 的冒烟测试 `tests/smoke.mjs`（8 场景 27 断言）**未随重写迁移**，
  仓库当前没有测试脚本（`npm run check` = typecheck + build）。

## 0.1.0 (2026-08-15)

- 首个版本：`dsh-custom-header` —— DeepSeek Harness 网关客户端签名
  注入插件。
- 传输层全保真实现（fetch 中间件管道 `dsh-custom-header.fetch.pipeline.v1`）：
  - `header-inject`：按请求注入 8 个预设的客户端签名头（`autoHosts` 门控
    固定 profile 始终注入）
  - `header-strip`：opencode_zen 预设剥离 `X-Stainless-*` / 运行时指纹头
    （仅 `autoHosts` 主机）
  - `url-rewrite`：路径重写 / query 追加（如 `/v1/messages` 追加
    `beta=true`），host 门控
  - `body-patch`：Anthropic Messages body 注入 `system` 块与
    `metadata.user_id`（JSON 设备/会话格式）
- 会话级 id：`agent/session-start` 轮换 `X-Claude-Code-Session-Id` 与
  `x-opencode-session`；`x-opencode-request` 每次请求新生成
  （opencode `Identifier.ascending()` 复刻）
- `llm/stream` 瀑布观察器：终态 403 诊断，区分 Cloudflare HTML 边缘拦截
  与网关 `client_restriction` JSON
- DSH 原生格式：schemastery `Config` schema、cordis.yml 插件节、
  `$DSH_HOME/plugins/dsh-custom-header.json` 运行时持久化、
  `ctx.dshCustomHeader` 服务（`status()` / `setProfile()`）
- 冒烟测试 `tests/smoke.mjs`：本地假网关覆盖 5 个场景（auto+Claude 体补丁、
  auto+Codex 回退、opencode_zen 动态 id + 指纹剥离、host 门控、off）

### 已知限制

- `accept-language` / `sec-fetch-mode` 由 undici 在 fetch 之下注入，
  扩展层无法剥离）
- 固定 profile（非 auto/off）不受 `autoHosts` 限制，全局注入（pi 同款语义）

### 0.1.0 行为等价修正（评审后）

- **会话 id 按对话隔离**：pi 是单会话进程（模块级 id 正确）；DSH 多 agent 并发，
  改为 `llm/stream` 包装器将 `GenerateOptions.sessionId` 经 AsyncLocalStorage
  传递到 fetch 层，`x-opencode-session` / `X-Claude-Code-Session-Id` / body
  `user_id` 均按会话惰性分配缓存；非 LLM 请求退回进程稳定 default 会话
- **前缀路由兼容**：Anthropic 判断从精确 `/v1/messages` 改为三态匹配
  （`/v1/messages`、`/v1/messages/…`、`…/v1/messages`），对齐 pi 按
  `model.api` 判断的语义（覆盖 baseUrl 带路径段的自建网关）
- 冒烟测试扩展至 7 场景 25 断言（新增会话隔离、前缀路由）

### 0.1.3（2026-08-15）

- 新增 **Settings → Plugins「请求头修改 / Custom Header」设置页**：
  client 端 React 面板 + Typert Remote 命名空间
  `customHeader/settingsGet|settingsSet`（host manifest + 浏览器 bundle，
  构建升级为 host + client 双产物）。字段：profile 下拉、
  autoCodexProfile、autoHosts 列表、claudeSystemMode、各版本号、
  opencodeClient/Project；保存即生效并持久化。
- 设置存储升级为完整配置（version 2）：持久化文件字段 > cordis.yml 字段 >
  默认值；显式 cordis.yml `profile` 仍优先。
- 依赖新增 zod（strict codecs）、react（客户端面板，optional peer）。

## 0.1.2（2026-08-15）

- 预设 `sub2api_pi_agent` 改名为 `pi_agent`（配置标识符去品牌化）；
  旧值不再识别，需手工更新 cordis.yml 与持久化 JSON 中的 profile 值。

## 0.1.1 真实性核对修正（对照 openai/codex 源码与网关白名单）

- **codex_official UA 修正**：真实构造为
  `{originator}/{版本} ({os_type} {os_version}; {arch}) {终端token}`
  （`get_codex_user_agent` + `terminal_detection`）；旧值尾部 `terminal`
  不是任何真实终端 token，改为 `WindowsTerminal`；版本默认 0.98.0 → 0.147.0，
  新增 `codexVersion` / `codexDesktopVersion` 配置
- **新增 `codex_tui` 预设**：交互式 `codex`（TUI 前端）实际发送
  `codex-tui/…` UA + `Originator: codex-tui`（白名单
  `is_first_party_originator`、TUI `client_name`、官方 UA 前缀列表三处互证）；
  与 `codex_official`（headless 默认）并列，均可选作 `autoCodexProfile`
- 冒烟测试扩至 8 场景 27 断言（新增 codex_tui 精确匹配）