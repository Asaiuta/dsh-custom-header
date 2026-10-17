/**
 * Configuration-page copy (zh / en), keyed flat.
 *
 * The dictionary namespace is the page's own, so nothing here has to be merged
 * with another plugin's texts. `zh` is typed against `en`'s keys, so a missing
 * translation is a compile error rather than a key rendered verbatim.
 *
 * Two registers are in play, and the split is deliberate:
 *
 * - `*Hint` is one line, always visible under its control. It says what the
 *   field decides.
 * - `*Help` is the long version, behind the row's "?" button. It holds the value
 *   vocabulary, the worked example, and the caveat — the material that used to
 *   sit under every row as permanent small print. The page can stay compact
 *   precisely because this text is still one click away.
 */

/** Locale dictionary namespace owned by this plugin. */
export const NS = 'settings.customHeader'

export const en = {
	title: 'Custom header',
	summary: 'Outbound LLM request headers: client-identity presets, fingerprint stripping, URL rewriting and Anthropic body patching.',
	unavailable: 'This configuration is not available on this host.',
	readOnly: 'This deployment does not accept changes from here.',
	saveFailed: 'The change was not accepted; the stored configuration is unchanged.',
	save: 'Save',
	saving: 'Saving…',
	overridden: 'overridden',
	reset: 'reset',
	invalid: 'Not a value this field accepts.',
	helpLabel: 'More about this setting',
	jsonHint: 'A JSON object, e.g. {"key": "value"}.',

	// --- the scenario picker -------------------------------------------------
	scenarioLabel: 'What do you want to reach?',
	scenarioAuto: 'Auto',
	scenarioAutoHint: 'Route by path: requests to the hosts below get a client identity — Anthropic /v1/messages paths go out as Claude Code, anything else as the Codex fallback. Other hosts are left alone.',
	scenarioCodex: 'Codex',
	scenarioCodexHint: 'Impersonate a Codex client (User-Agent + Originator) on requests to the hosts below.',
	scenarioClaudeCode: 'Claude',
	scenarioClaudeCodeHint: 'Impersonate Claude Code — headers plus the system block / user_id body patch — on requests to the hosts below.',
	scenarioPi: 'pi',
	scenarioPiHint: 'Impersonate the pi agent on requests to the hosts below.',
	scenarioOpencode: 'opencode',
	scenarioOpencodeHint: 'Impersonate opencode, including its Zen free tier, on requests to the hosts below.',
	scenarioOff: 'Off',
	scenarioOffHint: 'The plugin stands down: requests go out untouched.',
	variantLabel: 'Which Codex',
	profileEcho: 'Staged profile:',

	// --- Codex profile names (shared with the auto fallback row) -------------
	profileCodexOfficial: 'official',
	profileCodexTui: 'TUI',
	profileCodexDesktop: 'Desktop',
	profileCodexClaudePlugin: 'Claude plugin',
	modeIdentity: 'identity',
	modeBilling: 'billing',

	// --- the shell: brand block and the three pages --------------------------
	brandTag: 'Client signature',
	navIdentity: 'Identity & gateway',
	navVersions: 'Version headers',
	navAdvanced: 'Advanced',
	overlineIdentity: 'Identity',
	overlineVersions: 'Versions',
	overlineAdvanced: 'Advanced',
	descIdentity: 'Pick the client preset — who requests should look like — then set the gateway hosts where that identity applies.',
	descVersions: 'The version each preset claims. Defaults track the real clients; change one only when a gateway starts rejecting it.',
	descAdvanced: 'General switches that belong to no single preset.',

	// --- fields --------------------------------------------------------------
	profile: 'Client profile',
	profileHint: 'Chosen by the scenario picker above.',

	codexFallback: 'Codex fallback',
	codexFallbackHint: 'Which Codex identity Auto falls back to for non-Claude paths.',
	gatewayHosts: 'Gateway hosts',
	gatewayHostsHint: 'One host per line; subdomains match. Required for anything to happen.',
	gatewayHostsHelp: 'The single safety boundary: every profile — Auto and fixed ones alike — touches only requests to these hosts. Subdomains match, so `example.com` also covers `api.example.com`. An empty list is a safe no-op: nothing is injected, stripped, rewritten or patched. Find the host in your provider’s base URL.',
	claudeSystemBlock: 'Claude system block',
	claudeSystemBlockHint: 'Which system block the body patch injects.',

	claudeCliVersion: 'Claude CLI version',
	codexCliVersion: 'Codex CLI version',
	codexDesktopVersion: 'Codex Desktop version',
	anthropicBeta: 'anthropic-beta header',
	anthropicBetaHint: 'Sent with the Claude profile.',
	opencodeVersion: 'opencode version',
	opencodeClient: 'x-opencode-client',
	opencodeProject: 'x-opencode-project',
	opencodeHeaderHint: 'Sent as this x-opencode-* header value.',
	versionHint: 'Written into the preset’s User-Agent.',
	versionHelp: 'The version a request claims to be. Each default lives beside the preset in `defaults.ts` and is refreshed when a real client changes its string; only edit one if the gateway has started rejecting the version this plugin sends, and expect the claim to be checked more strictly than the name.',

	opencodeZenFree: 'opencode Zen free tier',
	opencodeZenFreeHint: 'Rewrites /zen to /inference and adds tool stubs.',
	opencodeZenFreeHelp: 'Zen’s free tier no longer accepts header spoofing alone: it wants the request on `/inference` and expects `bash` and `read` tool stubs to be declared. Turning this on does both, for the free model ids (`*-free`, `big-pickle`, `grok-code`) only. The stubs are added to the tools already in the request, never in place of them, and a name the request already offers is left alone. Point the OpenAI root at `https://opencode.ai/zen`.',

	extraHeaders: 'Extra headers',
	extraHeadersHelp: 'Merged onto every profile, after the preset’s own headers — so a name here wins over the preset. Useful when a gateway wants a header this plugin does not model. Header names are case-insensitive; values are sent verbatim.',
	urlRewrites: 'URL rewrites',
	rewriteHint: 'A JSON object mapping a path to its replacement.',
	rewriteHelp: 'A JSON object: each key is a path the gateway endpoint is serving, each value is what to send instead — either a string path, or {"path": "…", "appendQuery": "…"}. `appendQuery` is the escape hatch for servers that insist on a parameter, e.g. mapping /v1/messages to itself with appendQuery "beta=true". A half-typed object blocks the save rather than writing a partial rule.',
} as const

export type CustomHeaderKey = keyof typeof en

export const zh: Record<CustomHeaderKey, string> = {
	title: '请求头修改',
	summary: '出站 LLM 请求头：客户端身份预设、指纹头剥离、URL 重写与 Anthropic 请求体补丁。',
	unavailable: '本主机未提供这份配置。',
	readOnly: '当前部署不接受从此处修改。',
	saveFailed: '改动未被接受，已存的配置保持不变。',
	save: '保存',
	saving: '保存中…',
	overridden: '已覆盖',
	reset: '恢复默认',
	invalid: '不是本字段接受的值。',
	helpLabel: '这个设置的更多说明',
	jsonHint: 'JSON 对象，例如 {"key": "value"}。',

	scenarioLabel: '你想让谁连上网关？',
	scenarioAuto: '自动',
	scenarioAutoHint: '按路径路由：命中白名单的请求自动带上身份——Anthropic 的 /v1/messages 路径走 Claude Code，其余走 Codex 兜底；其他主机的请求一律不碰。',
	scenarioCodex: 'Codex',
	scenarioCodexHint: '伪装成 Codex 客户端（User-Agent + Originator），只作用于白名单主机上的请求。',
	scenarioClaudeCode: 'Claude',
	scenarioClaudeCodeHint: '伪装成 Claude Code（请求头 + system 块与 user_id 请求体补丁），只作用于白名单主机上的请求。',
	scenarioPi: 'pi',
	scenarioPiHint: '伪装成 pi agent，只作用于白名单主机上的请求。',
	scenarioOpencode: 'opencode',
	scenarioOpencodeHint: '伪装成 opencode（含 Zen 免费档），只作用于白名单主机上的请求。',
	scenarioOff: '关闭',
	scenarioOffHint: '插件完全不介入：请求按原样发出。',
	variantLabel: '用哪个 Codex',
	profileEcho: '当前暂存的 profile：',

	profileCodexOfficial: '官方',
	profileCodexTui: 'TUI',
	profileCodexDesktop: '桌面端',
	profileCodexClaudePlugin: 'Claude 插件',
	modeIdentity: 'identity',
	modeBilling: 'billing',

	brandTag: '客户端签名',
	navIdentity: '身份与网关',
	navVersions: '版本与请求头',
	navAdvanced: '高级',
	overlineIdentity: '身份',
	overlineVersions: '版本',
	overlineAdvanced: '高级',
	descIdentity: '选择客户端预设——请求要伪装成谁——再指定该身份生效的网关主机。',
	descVersions: '各预设自称的版本。默认值跟随真实客户端，只在网关开始拒绝时才需要改。',
	descAdvanced: '不属于任何单一预设的通用开关。',

	profile: '客户端预设（profile）',
	profileHint: '由上面的场景选择器决定。',

	codexFallback: 'Codex 兜底',
	codexFallbackHint: '「自动」遇到非 Claude 路径时兜底用哪个 Codex 身份。',
	gatewayHosts: '网关主机',
	gatewayHostsHint: '每行一个主机；子域自动匹配。不填则什么都不会发生。',
	gatewayHostsHelp: '唯一的安全边界：所有预设（无论「自动」还是固定预设）都只作用于发往这些主机的请求。子域自动匹配，填 `example.com` 也覆盖 `api.example.com`。留空即完全不动任何请求——不注入、不剥离、不重写、不补丁。主机名在 provider 的 base URL 里找。',
	claudeSystemBlock: 'Claude system 块',
	claudeSystemBlockHint: '请求体补丁注入哪种 system 块。',

	claudeCliVersion: 'Claude CLI 版本',
	codexCliVersion: 'Codex CLI 版本',
	codexDesktopVersion: 'Codex 桌面端版本',
	anthropicBeta: 'anthropic-beta 请求头',
	anthropicBetaHint: '随 Claude 预设发送。',
	opencodeVersion: 'opencode 版本',
	opencodeClient: 'x-opencode-client',
	opencodeProject: 'x-opencode-project',
	opencodeHeaderHint: '作为该 x-opencode-* 请求头的值发送。',
	versionHint: '写入该预设的 User-Agent。',
	versionHelp: '请求自称的版本号。每个默认值都和预设放在一起（`defaults.ts`），真实客户端改字符串时一起更新。只有网关开始拒绝本插件当前发送的版本时才需要动它；并且要知道版本号比名字更容易被服务端严格校验。',

	opencodeZenFree: 'opencode Zen 免费档',
	opencodeZenFreeHint: '把 /zen 改写到 /inference 并补上工具桩。',
	opencodeZenFreeHelp: 'Zen 的免费档不再只靠改请求头就能过：它要求请求走 `/inference`，并且要声明 `bash` 与 `read` 两个工具桩。打开这一项会同时做这两件事，仅对免费模型（`*-free`、`big-pickle`、`grok-code`）生效。工具桩是**追加**到请求已有的工具之后，不会取代它们；请求已经提供过的名字也不会重复插入。OpenAI 根地址请指向 `https://opencode.ai/zen`。',

	extraHeaders: '额外请求头',
	extraHeadersHelp: '合并到所有预设之上，且在预设自带头之后——所以这里同名会覆盖预设。当网关要的请求头本插件没有建模时用它。请求头名不区分大小写，值原样发送。',
	urlRewrites: 'URL 重写',
	rewriteHint: 'JSON 对象：路径 → 替换值。',
	rewriteHelp: 'JSON 对象：键是网关正在提供的路径，值是实际要发出的——字符串路径，或者 {"path": "…", "appendQuery": "…"}。`appendQuery` 是给那些强制要求某个参数的服务的出口，例如把 /v1/messages 映射到它自己并追加 beta=true。JSON 没写完整会拦住保存，而不会写进去半条规则。',
}
