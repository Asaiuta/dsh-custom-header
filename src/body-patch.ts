/**
 * Request-body reshaping at the fetch layer. Two jobs:
 *
 * 1. **Anthropic Messages identity patch** (`claude_code_messages`): the
 *    `system` slot gains the Claude Code identity (or billing) block when no
 *    Claude Code system signal is present, and `metadata.user_id` becomes
 *    the measured JSON device/session object.
 * 2. **opencode Zen free tier** (`opencode_zen` + `opencodeZenFree`): the URL
 *    is rewritten `/zen` → `/inference` and the `bash`/`read` tool stubs the
 *    free tier checks for are appended to `tools` (the caller's own tools are
 *    kept) — applied only when the body's model id names a free model. That
 *    model check is why the URL rewrite lives here rather than in
 *    `url-rewrite.ts`.
 *
 * Guard rails (unchanged from the adapter era):
 *   - only true Anthropic Messages bodies are identity-patched (must contain
 *     both `messages` and `model`); OpenAI-family bodies must never receive
 *     `system`/`metadata`;
 *   - a streamed (non-re-readable) body passes through untouched;
 *   - nothing runs before `resolveProfileForUrl` accepted the request — the
 *     host allowlist and the `off` profile gate every branch.
 */

import type { FetchMiddleware } from "./fetch-pipeline.ts";
import type { ResolvedCustomHeaderConfig } from './config.ts'
import type { GatewayClientProfileId } from './types.ts'
import { isAnthropicMessagesUrl, resolveProfileForUrl } from './profiles.ts'
import {
	CLAUDE_CODE_IDENTITY_SYSTEM,
	claudeCodeBillingSystemBlock,
	getClaudeCodeSessionId,
} from './profiles.ts'
import { sessionKeyOf } from './session-context.ts'
import { isOpencodeFreeModel, patchOpencodeZenFreeBody, rewriteOpencodeZenUrl } from './opencode-zen.ts'
import { withUrl } from './url-rewrite.ts'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Stable device fingerprint (process-level). The CLI uses a 64-hex device id. */
const STABLE_DEVICE_ID =
	'1dcf65c37100eb22dea67fe52f799f8e75716d2dfcf1dd5b2acbf07395170f4b'

function buildClaudeCodeUserId(sessionKey?: string): string {
	const sessionId = getClaudeCodeSessionId(sessionKey)
	return JSON.stringify({
		device_id: STABLE_DEVICE_ID,
		account_uuid: '',
		session_id: sessionId,
	})
}

function hasClaudeCodeSystemSignal(system: unknown): boolean {
	if (typeof system === 'string') {
		return (
			(system.includes('x-anthropic-billing-header') && system.includes('cc_entrypoint=sdk-cli')) ||
			system.replace(/\s+/g, ' ').includes(CLAUDE_CODE_IDENTITY_SYSTEM)
		)
	}
	if (!Array.isArray(system)) return false
	for (const entry of system) {
		if (!isRecord(entry)) continue
		const text = entry.text
		if (typeof text !== 'string' || text === '') continue
		if (
			text.startsWith('x-anthropic-billing-header') &&
			text.includes('cc_entrypoint=sdk-cli')
		) {
			return true
		}
		if (text.replace(/\s+/g, ' ').includes(CLAUDE_CODE_IDENTITY_SYSTEM)) {
			return true
		}
	}
	return false
}

function ensureMetadataUserId(metadata: unknown, sessionKey?: string): JsonRecord {
	if (!isRecord(metadata)) {
		return { user_id: buildClaudeCodeUserId(sessionKey) }
	}
	const userId = metadata.user_id
	if (typeof userId === 'string' && userId.trim() !== '') {
		return metadata
	}
	return { ...metadata, user_id: buildClaudeCodeUserId(sessionKey) }
}

/**
 * Pure payload-level patch, exported for tests. No-op unless the payload is
 * a real Anthropic Messages body.
 */
export function patchAnthropicMessagesPayload(
	payload: unknown,
	mode: 'identity' | 'billing',
	config: Pick<ResolvedCustomHeaderConfig, 'claudeCliVersion'>,
	sessionKey?: string,
): unknown {
	if (!isRecord(payload)) return payload
	if (!('messages' in payload) || !('model' in payload)) return payload

	const next: JsonRecord = { ...payload }

	if (!hasClaudeCodeSystemSignal(next.system)) {
		const blockText =
			mode === 'billing'
				? claudeCodeBillingSystemBlock(config.claudeCliVersion)
				: CLAUDE_CODE_IDENTITY_SYSTEM
		const injected = { type: 'text', text: blockText }
		if (Array.isArray(next.system)) {
			next.system = [injected, ...next.system]
		} else if (typeof next.system === 'string' && next.system.trim() !== '') {
			next.system = [injected, { type: 'text', text: next.system }]
		} else {
			next.system = [injected]
		}
	}

	next.metadata = ensureMetadataUserId(next.metadata, sessionKey)

	return next
}

function urlOf(input: unknown): URL | null {
	try {
		if (typeof input === 'string') return new URL(input);
		if (input instanceof URL) return new URL(input);
		if (input instanceof Request) return new URL(input.url);
	} catch {
		// ignore malformed URLs
	}
	return null;
}

/**
 * Best-effort read of the outgoing body as text. String / ArrayBuffer /
 * Uint8Array (and Buffer) can be re-read safely; a ReadableStream, FormData
 * or URLSearchParams cannot, and returns null — the request then passes
 * through untouched.
 */
function bodyText(
	init: RequestInit | undefined,
	input: Parameters<typeof fetch>[0],
): string | null {
	const body = init?.body ?? (input instanceof Request ? input.body : undefined);
	if (typeof body === 'string') return body;
	if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
	if (body instanceof Uint8Array) return new TextDecoder().decode(body);
	if (body && typeof body === 'object' && 'buffer' in body && (body as { buffer?: unknown }).buffer instanceof ArrayBuffer) {
		return new TextDecoder().decode((body as { buffer: ArrayBuffer }).buffer);
	}
	return null;
}

/**
 * Middleware — patches the wire body (and, for Zen free, the URL) of
 * requests whose resolved profile calls for it. Runs after header injection
 * so the identity headers are already final; body and headers are
 * independent here.
 */
export function createBodyPatchMiddleware(
	getContext: () => { profile: GatewayClientProfileId; config: ResolvedCustomHeaderConfig },
): FetchMiddleware {
	return async ({ input, init, next }) => {
		const { profile, config } = getContext();
		const url = urlOf(input);
		const resolved = url
			? resolveProfileForUrl(
					profile,
					{ hostname: url.hostname, pathname: url.pathname },
					config,
					sessionKeyOf(),
			  )
			: undefined;
		if (!resolved || !url) {
			return next(input, init);
		}

		// ---- opencode Zen free tier: URL + tool stubs, decided by the model id ----
		if (config.opencodeZenFree && resolved.id === 'opencode_zen') {
			const zenText = bodyText(init, input);
			let zenPayload: unknown;
			if (zenText !== null) {
				try {
					zenPayload = JSON.parse(zenText);
				} catch {
					zenPayload = undefined;
				}
			}
			if (
				isRecord(zenPayload) &&
				typeof zenPayload.model === 'string' &&
				isOpencodeFreeModel(zenPayload.model)
			) {
				const nextUrl = rewriteOpencodeZenUrl(new URL(url));
				const nextInput = nextUrl.href === url.href ? input : withUrl(input, nextUrl);
				const headerBag = new Headers(
					init?.headers ?? (input instanceof Request ? input.headers : undefined),
				);
				// the old content-length no longer matches — drop it, Node recomputes.
				headerBag.delete('content-length');
				return next(nextInput, {
					...init,
					body: JSON.stringify(patchOpencodeZenFreeBody(zenPayload)),
					headers: headerBag,
				});
			}
			return next(input, init);
		}

		// ---- Anthropic Messages identity patch ----
		if (!resolved.patchAnthropicBody) {
			return next(input, init);
		}
		if (!isAnthropicMessagesUrl({ hostname: url.hostname, pathname: url.pathname })) {
			return next(input, init);
		}

		const text = bodyText(init, input);
		if (text === null) {
			return next(input, init);
		}

		let payload: unknown;
		try {
			payload = JSON.parse(text);
		} catch {
			return next(input, init);
		}

		const patched = patchAnthropicMessagesPayload(
			payload,
			config.claudeSystemBlock,
			config,
			sessionKeyOf(),
		);
		if (patched === payload) {
			return next(input, init);
		}

		const headerBag = new Headers(
			init?.headers ?? (input instanceof Request ? input.headers : undefined),
		);
		// the old content-length no longer matches — drop it, Node recomputes.
		headerBag.delete('content-length');
		return next(input, { ...init, body: JSON.stringify(patched), headers: headerBag });
	};
}
