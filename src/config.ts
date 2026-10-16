/**
 * Plugin configuration: cordis.yml `dsh-custom-header:` section as the
 * schema, `normalizeCustomHeaderConfig()` as the single sanitizer.
 *
 * Native DSH-style: the schema lives on the plugin (schemastery), the
 * deployment config lives in cordis.yml, and the `dsh-settings` service
 * auto-derives the Settings UI form from this schema — no hand-written
 * Typert Remote channel. Every field optional; defaults fill the rest.
 */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_ANTHROPIC_BETA, DEFAULT_CLAUDE_CLI_VERSION, DEFAULT_CODEX_CLI_VERSION, DEFAULT_CODEX_DESKTOP_VERSION, DEFAULT_OPENCODE_VERSION } from './defaults.ts'
import type { CodexFallbackId, GatewayClientProfileId } from './types.ts'
import { isCodexFallbackId, isGatewayClientProfileId } from './types.ts'
import type { UrlRewriteTarget } from './url-rewrite.ts'

/** Deployment configuration. Every field optional; defaults fill the rest. */
export interface CustomHeaderConfig {
	/** auto | off | codex_desktop | codex_official | codex_tui | codex_claude_plugin | pi_agent | claude_code_messages | opencode_zen */
	profile?: GatewayClientProfileId;
	/** The gateway's hostnames: the single safety boundary gating every profile (fixed ones included). Empty = no-op. */
	gatewayHosts?: string[];
	/** Which system block the Claude body patch injects: the agent identity prompt ("identity") or the billing header block ("billing"). */
	claudeSystemBlock?: 'identity' | 'billing';
	/** Override claude-cli/x.y.z (default 2.1.220). */
	claudeCliVersion?: string;
	/** Override anthropic-beta header for the Claude profile. */
	anthropicBeta?: string;
	/** Override codex_cli_rs/x.y.z (default 0.147.0). */
	codexCliVersion?: string;
	/** Override codex_app/x.y.z (default 1.2026.0628). */
	codexDesktopVersion?: string;
	/** Override opencode/x.y.z (default 1.19.0). */
	opencodeVersion?: string;
	/** x-opencode-client value (default "cli"). */
	opencodeClient?: string;
	/** x-opencode-project value (default "global"). */
	opencodeProject?: string;
	/** Enable opencode Zen free-tier compatibility (URL `/zen`→`/inference` + `bash`/`read` tool stubs). */
	opencodeZenFree?: boolean;
	/** Merged after profile headers (all profiles). */
	extraHeaders?: Record<string, string>;
	/** Auto profile: which Codex identity non-Anthropic paths fall back to (default codex_official). */
	codexFallback?: CodexFallbackId;
	/** URL rewrites applied to the gateway endpoint path. */
	urlRewrites?: Record<string, string | UrlRewriteTarget>;
}

/** Every field resolved. */
export interface ResolvedCustomHeaderConfig {
	profile: GatewayClientProfileId;
	gatewayHosts: string[];
	claudeSystemBlock: 'identity' | 'billing';
	claudeCliVersion: string;
	codexCliVersion: string;
	codexDesktopVersion: string;
	anthropicBeta: string;
	opencodeVersion: string;
	opencodeClient: string;
	opencodeProject: string;
	opencodeZenFree: boolean;
	extraHeaders: Record<string, string>;
	codexFallback: CodexFallbackId;
	urlRewrites: Record<string, string | UrlRewriteTarget>;
}

export const CUSTOM_HEADER_DEFAULTS: ResolvedCustomHeaderConfig = {
	profile: 'auto',
	gatewayHosts: [],
	claudeSystemBlock: 'identity',
	claudeCliVersion: DEFAULT_CLAUDE_CLI_VERSION,
	codexCliVersion: DEFAULT_CODEX_CLI_VERSION,
	codexDesktopVersion: DEFAULT_CODEX_DESKTOP_VERSION,
	anthropicBeta: DEFAULT_ANTHROPIC_BETA,
	opencodeVersion: DEFAULT_OPENCODE_VERSION,
	opencodeClient: 'cli',
	opencodeProject: 'global',
	opencodeZenFree: false,
	extraHeaders: {},
	codexFallback: 'codex_official',
	urlRewrites: {},
}

const SYSTEM_BLOCKS: readonly ResolvedCustomHeaderConfig['claudeSystemBlock'][] = ['identity', 'billing']

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	const out: string[] = []
	for (const entry of value) {
		if (typeof entry !== 'string') continue
		const trimmed = entry.trim()
		if (trimmed.length === 0) continue
		out.push(trimmed)
	}
	return out
}

function cleanHeaders(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {}
	const out: Record<string, string> = {}
	for (const [key, val] of Object.entries(value)) {
		if (typeof val === 'string') out[key] = val
	}
	return out
}

function cleanUrlRewrites(value: unknown): Record<string, string | UrlRewriteTarget> {
	if (!isRecord(value)) return {}
	const out: Record<string, string | UrlRewriteTarget> = {}
	for (const [key, val] of Object.entries(value)) {
		if (typeof key !== 'string' || key.length === 0) continue
		if (typeof val === 'string' && val.length > 0) {
			out[key] = val
		} else if (isRecord(val)) {
			const target: { path?: string; appendQuery?: string } = {}
			if (typeof val.path === 'string' && val.path.length > 0) target.path = val.path
			if (typeof val.appendQuery === 'string' && val.appendQuery.length > 0) target.appendQuery = val.appendQuery
			if (Object.keys(target).length > 0) out[key] = target
		}
	}
	return out
}

function mergeRaw(
	base: ResolvedCustomHeaderConfig,
	raw: Record<string, unknown>,
): ResolvedCustomHeaderConfig {
	const next: ResolvedCustomHeaderConfig = { ...base, extraHeaders: { ...base.extraHeaders } }
	if (typeof raw.profile === 'string' && isGatewayClientProfileId(raw.profile)) next.profile = raw.profile
	if (raw.gatewayHosts !== undefined) next.gatewayHosts = cleanStringList(raw.gatewayHosts)
	if (raw.claudeSystemBlock === 'identity' || raw.claudeSystemBlock === 'billing') next.claudeSystemBlock = raw.claudeSystemBlock
	if (typeof raw.claudeCliVersion === 'string' && raw.claudeCliVersion.trim()) next.claudeCliVersion = raw.claudeCliVersion.trim()
	if (typeof raw.codexCliVersion === 'string' && raw.codexCliVersion.trim()) next.codexCliVersion = raw.codexCliVersion.trim()
	if (typeof raw.codexDesktopVersion === 'string' && raw.codexDesktopVersion.trim()) next.codexDesktopVersion = raw.codexDesktopVersion.trim()
	if (typeof raw.anthropicBeta === 'string' && raw.anthropicBeta.trim()) next.anthropicBeta = raw.anthropicBeta.trim()
	if (typeof raw.opencodeVersion === 'string' && raw.opencodeVersion.trim()) next.opencodeVersion = raw.opencodeVersion.trim()
	if (typeof raw.opencodeClient === 'string' && raw.opencodeClient.trim()) next.opencodeClient = raw.opencodeClient.trim()
	if (typeof raw.opencodeProject === 'string' && raw.opencodeProject.trim()) next.opencodeProject = raw.opencodeProject.trim()
	if (typeof raw.opencodeZenFree === 'boolean') next.opencodeZenFree = raw.opencodeZenFree
	if (raw.extraHeaders !== undefined) next.extraHeaders = { ...next.extraHeaders, ...cleanHeaders(raw.extraHeaders) }
	if (typeof raw.codexFallback === 'string' && isCodexFallbackId(raw.codexFallback)) next.codexFallback = raw.codexFallback
	if (raw.urlRewrites !== undefined) next.urlRewrites = cleanUrlRewrites(raw.urlRewrites)
	return next
}

/**
 * The single sanitizer: arbitrary input (cordis.yml seed, future patches) →
 * fully resolved config. Unknown keys are dropped; bad values fall back to
 * their defaults.
 */
export function normalizeCustomHeaderConfig(
	raw: Record<string, unknown>,
	base: ResolvedCustomHeaderConfig = { ...CUSTOM_HEADER_DEFAULTS, extraHeaders: {} },
): ResolvedCustomHeaderConfig {
	const next = mergeRaw({ ...base }, raw)
	if (!SYSTEM_BLOCKS.includes(next.claudeSystemBlock)) {
		next.claudeSystemBlock = 'identity'
	}
	return next
}

/**
 * schemastery schema mirror of {@link CustomHeaderConfig} (the loader validates
 * cordis.yml against it).
 *
 * ### Why every field is `.volatile()`
 *
 * This is the whole reason the plugin has a settings page. DSH's settings
 * service publishes a form for a profile entry **only** when its schema has at
 * least one volatile field (`dsh-settings`: `volatileForm(schema) === undefined`
 * ⇒ the entry is dropped from `describe()`), and its writer rejects any path
 * that is not volatile (`Config field "x.y" is not volatile`). A plugin whose
 * config is all non-volatile therefore has no form to show and nothing a form
 * could write.
 *
 * Volatility is also the right *runtime* semantics here:
 *
 * - A volatile field reaches `apply()` as a reference, not a value
 *   (`config.gatewayHosts.get()`), and a volatile-only change is committed
 *   straight into the running fiber's references by the Loader — no remount,
 *   no restart. `index.ts` re-reads the refs on `loader/volatile-update`, so
 *   the next gateway request already carries the edit.
 * - The fetch middlewares resolve everything from that per-request snapshot,
 *   so the host allowlist, header presets, versions and rewrites are all
 *   live values.
 *
 * Declared volatile fields must sit at a fixed object path with no enclosing
 * volatile field, and must not carry functions or cycles — every field below is
 * a top-level scalar, string list, or plain dict.
 */
export const ConfigSchema = z.object({
	profile: z.string().default('auto').volatile(),
	gatewayHosts: z.array(z.string()).default([]).volatile(),
	claudeSystemBlock: z.string().default('identity').volatile(),
	claudeCliVersion: z.string().default(DEFAULT_CLAUDE_CLI_VERSION).volatile(),
	codexCliVersion: z.string().default(DEFAULT_CODEX_CLI_VERSION).volatile(),
	codexDesktopVersion: z.string().default(DEFAULT_CODEX_DESKTOP_VERSION).volatile(),
	anthropicBeta: z.string().default(DEFAULT_ANTHROPIC_BETA).volatile(),
	opencodeVersion: z.string().default(DEFAULT_OPENCODE_VERSION).volatile(),
	opencodeClient: z.string().default('cli').volatile(),
	opencodeProject: z.string().default('global').volatile(),
	opencodeZenFree: z.boolean().default(false).volatile(),
	extraHeaders: z.dict(z.string()).default({}).volatile(),
	codexFallback: z.string().default('codex_official').volatile(),
	urlRewrites: z
		.dict(
			z.union([
				z.string(),
				z.object({
					path: z.string(),
					appendQuery: z.string(),
				}),
			]),
		)
		.default({})
		.volatile(),
})

export type ConfigType = Partial<CustomHeaderConfig>

/** A volatile config reference, as Cordis hands one to `apply()`. */
export interface VolatileRef<T = unknown> {
	get(): T
}

function isVolatileRef(value: unknown): value is VolatileRef {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	return typeof (value as { get?: unknown }).get === 'function'
}

/**
 * Read the configuration as plain values, once per call.
 *
 * Every field the schema marks `.volatile()` arrives as a reference whose
 * target the Loader swaps in place, so this must be called again after each
 * `loader/volatile-update` rather than captured at `apply()` time. Fields that
 * are somehow delivered as plain values pass through untouched, which keeps the
 * reader correct if the schema stops marking one.
 *
 * @param config - the plugin configuration as `apply()` received it.
 * @returns a plain record suitable for {@link normalizeCustomHeaderConfig}.
 */
export function readLiveConfig(config: Record<string, unknown> | undefined): Record<string, unknown> {
	const raw: Record<string, unknown> = {}
	if (config === undefined) return raw
	for (const [key, value] of Object.entries(config)) {
		raw[key] = isVolatileRef(value) ? value.get() : value
	}
	return raw
}