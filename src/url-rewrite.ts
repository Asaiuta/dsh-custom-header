/**
 * URL rewriting at the fetch layer.
 *
 * DSH's LLM seam (`GenerateOptions`) exposes no request URL — adapters build
 * it inside the SDK — so the only place to rewrite a path or append a query
 * is one layer below the SDK, at fetch time.
 *
 * The generic `urlRewrites` config (path → new path / extra query) is the
 * whole surface; opencode Zen's `/zen` → `/inference` rewrite does NOT live
 * here, because it may only apply when the *body's* model id is a free one —
 * that decision belongs to the body-patch middleware (`body-patch.ts`), which
 * rewrites the URL itself through {@link withUrl}.
 *
 * Safety: a rewrite applies ONLY when
 *   1. the profile is not `off`,
 *   2. the request hostname is listed in `config.gatewayHosts`, and
 *   3. the pathname matches a configured `urlRewrites` rule.
 * Everything else passes through untouched.
 */

import type { FetchMiddleware } from './fetch-pipeline.ts'
import { hostMatchesGatewayHosts } from './profiles.ts'

export type UrlRewriteTarget =
	| string // new pathname (e.g. "/v1/messages")
	| {
			/** Replace the request pathname with this value. */
			path?: string;
			/** Raw query string appended to the existing query (e.g. "beta=true"). */
			appendQuery?: string;
	  };

export interface UrlRewriteContext {
	/** Set to false when the profile is "off" — disables all rewriting. */
	enabled: boolean;
	/** Only hosts listed here may be rewritten (from config.gatewayHosts). */
	hosts: string[];
	/** pathname (exact or suffix match, prefix when the key ends with "*") → target. */
	rewrites: Record<string, UrlRewriteTarget>;
}

export interface RewrittenPath {
	pathname: string;
	appendQuery?: string;
}

/** Match one rewrite rule against a pathname. */
function matchRule(
	pathname: string,
	pattern: string,
	target: UrlRewriteTarget,
): RewrittenPath | null {
	const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
	const matches =
		prefix !== null
			? pathname.startsWith(prefix)
			: pathname === pattern || pathname.endsWith(pattern);
	if (!matches) return null;

	if (typeof target === 'string') return { pathname: target };
	return {
		pathname:
			typeof target.path === 'string' && target.path.length > 0
				? target.path
				: pathname,
		appendQuery: typeof target.appendQuery === 'string' && target.appendQuery
			? target.appendQuery
			: undefined,
	};
}

/**
 * Project one pathname through the configured rewrite rules.
 * @param pathname - the endpoint pathname to rewrite.
 * @param rewrites - pathname → new path / appendQuery rules.
 * @returns the effective pathname + optional appended query (unchanged path when no rule matches).
 */
export function rewritePath(
	pathname: string,
	rewrites: Record<string, UrlRewriteTarget>,
): RewrittenPath {
	for (const [pattern, target] of Object.entries(rewrites)) {
		const rule = matchRule(pathname, pattern, target);
		if (rule !== null) return rule;
	}
	return { pathname };
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
 * Rebuild a fetch input against a new URL, preserving the input's shape:
 * a string stays a string, a URL stays a URL, a Request is recreated (its
 * method, headers and body carry over untouched).
 */
export function withUrl(
	input: Parameters<typeof fetch>[0],
	url: URL,
): Parameters<typeof fetch>[0] {
	if (typeof input === 'string') return url.toString();
	if (input instanceof URL) return url;
	return new Request(url.toString(), input);
}

/** Apply one matched rule to a URL (pure clone; the input URL is left alone). */
function applyRule(url: URL, rule: RewrittenPath): URL {
	const next = new URL(url);
	if (rule.pathname && rule.pathname !== url.pathname) {
		next.pathname = rule.pathname;
	}
	if (rule.appendQuery) {
		next.search = next.search
			? `${next.search}&${rule.appendQuery}`
			: `?${rule.appendQuery}`;
	}
	return next;
}

/**
 * Rewrite one fetch input per the context, or return it unchanged:
 * disabled context, empty allowlist, unmatched host and unmatched path all
 * pass the request through untouched.
 */
export function rewriteUrlIfNeeded(
	input: Parameters<typeof fetch>[0],
	ctx: UrlRewriteContext,
): Parameters<typeof fetch>[0] {
	if (!ctx.enabled) return input;
	if (ctx.hosts.length === 0) return input;
	const url = urlOf(input);
	if (!url) return input;
	if (!hostMatchesGatewayHosts(url.hostname, ctx.hosts)) return input;

	const rule = rewritePath(url.pathname, ctx.rewrites);
	if (rule.pathname === url.pathname && rule.appendQuery === undefined) return input;

	return withUrl(input, applyRule(url, rule));
}

/** Middleware factory — reads the context fresh on every request. */
export function createUrlRewriteMiddleware(
	getContext: () => UrlRewriteContext,
): FetchMiddleware {
	return async ({ input, init, next }) => {
		const rewritten = rewriteUrlIfNeeded(input, getContext());
		return next(rewritten, init);
	};
}
