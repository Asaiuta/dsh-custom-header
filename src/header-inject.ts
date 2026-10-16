/**
 * Header injection + fingerprint stripping at the fetch layer.
 *
 * SDKs append `X-Stainless-*` fingerprint headers AFTER any header hook, so
 * stripping must happen at the fetch layer, next to injection. DSH has no
 * per-request header hook at all, so both jobs live in the fetch pipeline
 * as two adjacent middlewares:
 *
 *   1. `custom-header-strip`  (priority 6) — delete `dropHeaders`
 *      (opencode's stainless fingerprint set) before sending.
 *   2. `custom-header-inject` (priority 7) — apply the resolved profile
 *      headers. Each request re-resolves the profile, so opencode_zen
 *      regenerates `x-opencode-request` per request exactly like the pi
 *      before_provider_headers path did.
 *
 * Safety gate: both middlewares resolve the profile through
 * `resolveProfileForUrl`, which refuses every profile unless the request
 * host is listed in gatewayHosts — stripping, injection and pass-through all
 * follow that one rule, so nothing outside the allowlist is ever touched.
 */

import type { FetchMiddleware } from "./fetch-pipeline.ts";
import type { ResolvedCustomHeaderConfig } from "./config.ts";
import type { GatewayHeaderProfile } from "./profiles.ts";
import { resolveProfileForUrl } from "./profiles.ts";
import { sessionKeyOf } from "./session-context.ts";
import type { GatewayClientProfileId } from "./types.ts";

export interface HeaderInjectContext {
	profile: GatewayClientProfileId;
	config: ResolvedCustomHeaderConfig;
}

function urlOf(input: unknown): URL | null {
	try {
		if (typeof input === "string") return new URL(input);
		if (input instanceof URL) return new URL(input);
		if (input instanceof Request) return new URL(input.url);
	} catch {
		// ignore malformed URLs
	}
	return null;
}

/**
 * Remove the given header names from init.headers / Request headers.
 * Headers may be a Headers instance, an array, or a plain object — all three
 * shapes are handled.
 */
function stripFromInit(
	init: RequestInit | undefined,
	drop: Set<string>,
): RequestInit | undefined {
	if (!init?.headers) return init;

	const headers = init.headers;

	if (headers instanceof Headers) {
		const next = new Headers(headers);
		for (const name of drop) {
			next.delete(name);
		}
		return { ...init, headers: next };
	}

	if (Array.isArray(headers)) {
		return {
			...init,
			headers: headers.filter(([k]) => !drop.has(String(k).toLowerCase())),
		};
	}

	const next: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers as Record<string, string>)) {
		if (drop.has(k.toLowerCase())) continue;
		next[k] = v;
	}
	return { ...init, headers: next };
}

/** Set headers onto init.headers / Request headers (preserving other values). */
function setOnInit(
	init: RequestInit | undefined,
	headers: Record<string, string>,
): RequestInit | undefined {
	const base = init ?? {};
	const existing = base.headers;
	const next = new Headers(existing);
	for (const [key, value] of Object.entries(headers)) {
		next.set(key, value);
	}
	return { ...base, headers: next };
}

/**
 * Middleware 1 — stripping. Deletes the resolved profile's `dropHeaders`
 * (the X-Stainless fingerprint set, for opencode) before sending. The pi
 * gateway could unmask a disguise by checking X-Stainless-* presence, so
 * this must run at the very end of the chain that sees the wire headers.
 */
export function createHeaderStripMiddleware(
	getContext: () => HeaderInjectContext,
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
		const drop = resolved?.dropHeaders;
		if (!drop || drop.length === 0) {
			return next(input, init);
		}

		const dropSet = new Set(drop.map((h) => h.toLowerCase()));

		if (input instanceof Request) {
			const nextHeaders = new Headers(input.headers);
			for (const name of dropSet) {
				nextHeaders.delete(name);
			}
			const rebuilt = new Request(input, { headers: nextHeaders });
			return next(rebuilt, stripFromInit(init, dropSet));
		}

		return next(input, stripFromInit(init, dropSet));
	};
}

/**
 * Middleware 2 — injection. Applies the resolved profile's headers.
 * Re-resolving the profile on every request regenerates per-request values
 * (opencode x-opencode-request) and always reads the current config.
 */
export function createHeaderInjectMiddleware(
	getContext: () => HeaderInjectContext,
): FetchMiddleware {
	return async ({ input, init, next }) => {
		const { profile, config } = getContext();
		const url = urlOf(input);
		const resolved = resolveProfileForUrl(
			profile,
			url
				? {
						hostname: url.hostname,
						pathname: url.pathname,
				  }
				: undefined,
			config,
			sessionKeyOf(),
		);
		if (!resolved) {
			return next(input, init);
		}

		if (Object.keys(resolved.headers).length === 0) {
			return next(input, init);
		}

		if (input instanceof Request) {
			const nextHeaders = new Headers(input.headers);
			for (const [key, value] of Object.entries(resolved.headers)) {
				nextHeaders.set(key, value);
			}
			const rebuilt = new Request(input, { headers: nextHeaders });
			return next(rebuilt, setOnInit(init, resolved.headers));
		}

		return next(input, setOnInit(init, resolved.headers));
	};
}