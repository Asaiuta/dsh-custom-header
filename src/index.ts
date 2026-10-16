/**
 * dsh-custom-header — gateway client-signature injection for DeepSeek
 * Harness (DSH), at the fetch transport layer.
 *
 * Modifies outbound LLM requests one layer below the LLM seam: DSH has no
 * per-request header hook, so client-identity header presets mirroring real
 * Codex / Claude Code / opencode clients, X-Stainless fingerprint
 * stripping, URL rewrites and request-body patches all live in one fetch
 * middleware chain (a `globalThis.fetch` patch keyed by a dedicated symbol,
 * `fetch-pipeline.ts`):
 *
 *   - header injection      → `dsh-custom-header-header-inject` (priority 7)
 *   - X-Stainless stripping → `dsh-custom-header-header-strip` (priority 6)
 *   - URL rewrite           → `dsh-custom-header-url-rewrite` (priority 5)
 *   - body patch            → `dsh-custom-header-body-patch` (priority 8;
 *     Anthropic identity patch + opencode Zen free tier)
 *   - session id scoping    → per-conversation ids via
 *     `GenerateOptions.sessionId` + AsyncLocalStorage (session-context.ts)
 *   - 403 diagnostics       → `llm/stream` waterfall observer
 *
 * ### Why fetch, not a provider-owning adapter
 *
 * The 0.2/0.3 line rewrote this plugin as provider-owning `LlmAdapter`s
 * registered through `ctx.llm.registerAdapter(routes, adapter)`. That
 * extension point is **per-route exclusive**: registering a route another
 * plugin owns (e.g. the `ziyong`/`moonshotai` providers that `llm-pi-ai`
 * already registers) throws `DUPLICATE_ADAPTER`, and the host exposes no way
 * to graft onto someone else's adapter. A fetch-layer interceptor has no
 * route ownership at all, so it composes with every provider — the point of
 * this plugin is exactly "make requests to *my* gateway look like client X",
 * whatever plugin those requests come from.
 *
 * The cost of the fetch seat is that only the request URL identifies a
 * request (never the owning provider), so the `gatewayHosts` allowlist is the
 * single safety boundary: every profile — fixed ones included — touches
 * only requests whose host matches, and an empty allowlist is a safe no-op.
 *
 * Config rides the volatile channel: `cordis.yml` `dsh-custom-header:`
 * seeds it, the browser half's configuration page (registered into the
 * Plugins page's `plugins.row.config` slot and again as its own Settings
 * section) edits it, and `dsh-settings` persists writes into this profile's
 * patch — see `client/index.tsx`. A volatile-only change never remounts the
 * plugin: `loader/volatile-update` re-reads the request-time snapshot, so
 * the next request already carries the edit. A runtime profile choice is
 * available through `ctx.dshCustomHeader.setProfile()`.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: brings the `llm/stream` event vocabulary in at typecheck time.
// At runtime nothing from this package is imported — the plugin only
// registers a listener.
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

import { normalizeCustomHeaderConfig, readLiveConfig, ConfigSchema, type ConfigType, type ResolvedCustomHeaderConfig } from './config.ts'
import { getProfileMenuEntries, type GatewayHeaderProfile } from './profiles.ts'
import { registerFetchMiddleware } from './fetch-pipeline.ts'
import { createHeaderStripMiddleware, createHeaderInjectMiddleware } from './header-inject.ts'
import { createUrlRewriteMiddleware } from './url-rewrite.ts'
import { createBodyPatchMiddleware } from './body-patch.ts'
import { format403Hint } from './response-hints.ts'
import { requestSessionContext } from './session-context.ts'
import type { GatewayClientProfileId } from './types.ts'

/** Cordis plugin name (the Loader entry). */
export const name = 'dsh-custom-header'

/** Services required before load: none hard — `llm/stream` is an optional observer. */
export const inject: string[] = []

/**
 * Deployment configuration (fetch shape). Every field optional; defaults
 * fill the rest. The schema itself lives in `config.ts`; this re-export is
 * what the Loader reads for cordis.yml validation and what `dsh-settings`
 * reads to publish the configuration namespace.
 */
export const Config: typeof ConfigSchema = ConfigSchema

/** Runtime state shared by every middleware (read fresh per request). */
interface RuntimeState {
	profile: GatewayClientProfileId
	config: ResolvedCustomHeaderConfig
}

/** The plugin's public service surface (diagnostics + programmatic switch). */
export interface CustomHeaderService {
	/** Effective profile & resolved config (diagnostics core). */
	status(): {
		profile: GatewayClientProfileId
		effective: string
		config: ResolvedCustomHeaderConfig
		profileMenu: string[]
	}
	/** Switch profile at runtime (in-memory; the next config edit clears it). */
	setProfile(profile: GatewayClientProfileId): void
}

/**
 * Mount the plugin.
 *
 * Configuration is read through the volatile references the Loader delivered,
 * so a settings-page save lands in the next gateway request without a
 * restart: `loader/volatile-update` re-reads every ref into the snapshot the
 * middlewares close over.
 *
 * @param ctx - host cordis context.
 * @param config - validated plugin configuration (schema defaults applied).
 */
export function apply(ctx: Context, config?: ConfigType): void {
	const raw = (config ?? {}) as Record<string, unknown>
	let resolved = normalizeCustomHeaderConfig(readLiveConfig(raw))
	let configuredProfile = resolved.profile
	/** Set by `setProfile()`; cleared as soon as the configuration itself changes `profile`. */
	let runtimeProfile: GatewayClientProfileId | undefined
	const state: RuntimeState = { profile: resolved.profile, config: resolved }

	// ---- fetch middleware chain (priority ascending) ----
	// Each middleware re-reads `state` per request, so a volatile update is
	// visible to the very next request without re-registering anything.
	registerFetchMiddleware({
		name: 'dsh-custom-header-url-rewrite',
		priority: 5,
		middleware: createUrlRewriteMiddleware(() => ({
			enabled: state.profile !== 'off',
			hosts: state.config.gatewayHosts,
			rewrites: state.config.urlRewrites,
		})),
	})
	registerFetchMiddleware({
		name: 'dsh-custom-header-header-strip',
		priority: 6,
		middleware: createHeaderStripMiddleware(() => ({
			profile: state.profile,
			config: state.config,
		})),
	})
	registerFetchMiddleware({
		name: 'dsh-custom-header-header-inject',
		priority: 7,
		middleware: createHeaderInjectMiddleware(() => ({
			profile: state.profile,
			config: state.config,
		})),
	})
	registerFetchMiddleware({
		name: 'dsh-custom-header-body-patch',
		priority: 8,
		middleware: createBodyPatchMiddleware(() => ({
			profile: state.profile,
			config: state.config,
		})),
	})

	// ---- session-scoped ids + 403 diagnostics: wrap the LLM stream ----
	// Every iteration of an adapter's stream (including the fetch it issues)
	// runs inside AsyncLocalStorage carrying GenerateOptions.sessionId, so the
	// fetch middlewares can scope x-opencode-session /
	// X-Claude-Code-Session-Id / metadata.user_id per DSH conversation
	// instead of sharing one process-wide id (concurrent DSH agents would
	// otherwise steal another conversation's ids).
	const logger = ctx.logger
	ctx.on('llm/stream', function (_options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) {
		const inner = next()
		const iterator = inner[Symbol.asyncIterator]()
		const sessionKey = String(_options.sessionId ?? '')

		const observe = (result: IteratorResult<StreamChunk>): IteratorResult<StreamChunk> => {
			const chunk = result.done ? undefined : result.value
			const failure =
				chunk?.type === 'finish' &&
				(chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
					? chunk.reason.failure
					: undefined
			if (failure?.status === 403) {
				logger.warn(`[dsh-custom-header] HTTP 403 — ${format403Hint({ message: failure.message, profile: state.profile })}`)
			}
			return result
		}

		const doneResult = (): IteratorResult<StreamChunk> => ({ done: true, value: undefined })
		const runNext = () => requestSessionContext.run(sessionKey, () => iterator.next())
		const runReturn = () =>
			requestSessionContext.run(sessionKey, () => iterator.return?.() ?? Promise.resolve(doneResult()))
		const runThrow = (err: unknown) =>
			requestSessionContext.run(sessionKey, () => iterator.throw?.(err) ?? Promise.resolve(doneResult()))

		return {
			[Symbol.asyncIterator]() {
				return {
					next: () => Promise.resolve(runNext()).then(observe),
					return: () => Promise.resolve(runReturn()).then(observe),
					throw: (err: unknown) => Promise.resolve(runThrow(err)).then(observe),
				}
			},
		}
	})

	// ---- programmatic service surface ----
	ctx.provide('dshCustomHeader', {
		status() {
			return {
				profile: state.profile,
				effective: effectiveStatus(state),
				config: { ...state.config, extraHeaders: { ...state.config.extraHeaders } },
				profileMenu: getProfileMenuEntries(state.config).map((m) => `${m.id} — ${m.label}`),
			}
		},
		setProfile(profile: GatewayClientProfileId) {
			runtimeProfile = profile
			state.profile = profile
			logger.info(`[dsh-custom-header] profile -> ${profile}`)
		},
	} satisfies CustomHeaderService)
	void runtimeProfile

	// This plugin renders its own configuration page, so `dsh-settings` must not
	// offer to auto-generate one. Absent Settings service ⇒ nothing to configure.
	ctx.inject(['settings'], (child: Context) => {
		const settings = child.settings as { configure?: (options: { auto: boolean }, fiber: unknown) => unknown } | undefined
		if (settings?.configure === undefined) return
		child.effect(() => {
			settings.configure?.({ auto: false }, ctx.fiber)
		}, 'dsh-custom-header: own configuration page')
	})

	// A settings-page save commits volatile-only changes into the running fiber
	// instead of remounting it, so the request-time snapshot is ours to refresh.
	ctx.on('loader/volatile-update', () => {
		try {
			const next = normalizeCustomHeaderConfig(readLiveConfig(raw))
			if (next.profile !== configuredProfile) {
				// An edit through the settings page outranks an earlier programmatic switch.
				configuredProfile = next.profile
				runtimeProfile = undefined
				state.profile = next.profile
			}
			resolved = next
			state.config = next
		} catch (error) {
			logger.error('[dsh-custom-header] refusing this configuration update:')
			logger.error(error)
			return
		}
		logger.info(`[dsh-custom-header] config updated live: ${effectiveStatus(state)}`)
		logger.info(`  gatewayHosts: ${state.config.gatewayHosts.length ? state.config.gatewayHosts.join(', ') : '(empty = nothing is touched)'}`)
	})

	// ---- startup diagnostics ----
	diagnostics(ctx, state)
}

function effectiveStatus(state: RuntimeState): string {
	const config = state.config
	if (state.profile === 'off') return 'off'
	if (config.gatewayHosts.length === 0) {
		return `off (${state.profile}: empty gatewayHosts — nothing is ever touched)`
	}
	if (state.profile === 'auto') {
		return `auto (hosts: ${config.gatewayHosts.join(', ')}, /v1/messages → claude_code_messages, others → ${config.codexFallback})`
	}
	return `${state.profile} (hosts: ${config.gatewayHosts.join(', ')})`
}

function diagnostics(ctx: Context, state: RuntimeState): void {
	const config = state.config
	const lines = [
		`dsh-custom-header loaded: profile=${state.profile}`,
		`  effective: ${effectiveStatus(state)}`,
		`  gatewayHosts: ${config.gatewayHosts.length ? config.gatewayHosts.join(', ') : '(empty = nothing is touched)'}`,
		`  codexFallback: ${config.codexFallback}`,
		`  claudeCliVersion: ${config.claudeCliVersion} · opencodeVersion: ${config.opencodeVersion}`,
		`  urlRewrites: ${Object.keys(config.urlRewrites).length ? `${Object.keys(config.urlRewrites).length} rule(s), gatewayHosts-gated` : 'none'}`,
		`  transport: fetch pipeline (strip+inject+rewrite+body-patch), host-scoped, provider-agnostic`,
		`  session ids: per-conversation (GenerateOptions.sessionId), x-opencode-request regenerates per request`,
	]
	for (const line of lines) {
		ctx.logger.info(line)
	}
}

export type { GatewayHeaderProfile }
export { resolveProfileForUrl, getProfileMenuEntries, hostMatchesGatewayHosts, describeEffectiveProfile, isAnthropicMessagesUrl } from './profiles.ts'
export { normalizeCustomHeaderConfig, CUSTOM_HEADER_DEFAULTS, readLiveConfig, type ResolvedCustomHeaderConfig } from './config.ts'
export { patchAnthropicMessagesPayload } from './body-patch.ts'
export { isOpencodeFreeModel, patchOpencodeZenFreeBody, rewriteOpencodeZenUrl } from './opencode-zen.ts'
export { isGatewayClientProfileId } from './types.ts'
export { registerFetchMiddleware, ensureFetchPipeline, type FetchMiddleware } from './fetch-pipeline.ts'
export { rewritePath, rewriteUrlIfNeeded, withUrl, type UrlRewriteTarget, type UrlRewriteContext } from './url-rewrite.ts'
export { createHeaderStripMiddleware, createHeaderInjectMiddleware } from './header-inject.ts'
export { createBodyPatchMiddleware } from './body-patch.ts'
export { createUrlRewriteMiddleware } from './url-rewrite.ts'
export { requestSessionContext, sessionKeyOf } from './session-context.ts'

/**
 * Named exports only — deliberately **no** `export default`.
 *
 * The Loader unpicks a plugin module with `unwrapExports`:
 *
 * ```js
 * exports = exports.default ?? exports
 * if (!exports.__esModule) return exports
 * return exports.default ?? exports
 * ```
 *
 * so a `default` export *replaces* the module namespace as the plugin object.
 * Exporting `default apply` therefore hands the registry the bare function:
 * `apply` still runs (its `ctx.logger` lines appear), but `fiber.runtime` is
 * that function, so `fiber.runtime.Config` is `undefined` — and `dsh-settings`
 * reads the schema from exactly there:
 *
 * ```js
 * schema(entry) { const schema = entry.fiber?.runtime?.Config; … }
 * if (schema === void 0 || … ) return []      // no namespace is published
 * ```
 *
 * The failure is silent and misleading: the plugin loads, the client half
 * still registers its page, and the page then reports "this host does not
 * serve this configuration" — which reads like a client bug. Every shipped
 * host half exports named only (`export { Config, apply }`); so does this one.
 * `build.mjs` asserts the absence of a default export after every build.
 */
