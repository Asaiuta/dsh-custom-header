/**
 * Measured default version / header constants.
 */

/** Claude Code 2.1.220 measured UA version (sdk-cli entrypoint). */
export const DEFAULT_CLAUDE_CLI_VERSION = '2.1.220'

/**
 * Claude Code 2.1.220 measured anthropic-beta list (sdk-cli entrypoint).
 * Aligned capture: claude-code-20250219, interleaved-thinking-2025-05-14,
 * thinking-token-count-2026-05-13, context-management-2025-06-27,
 * prompt-caching-scope-2026-01-05, mid-conversation-system-2026-04-07,
 * effort-2025-11-24, fallback-credit-2026-06-01.
 */
export const DEFAULT_ANTHROPIC_BETA =
	'claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24,fallback-credit-2026-06-01'

/**
 * opencode version the UA presents as. 1.19.0 is the current release and the
 * version the real client now sends Zen; the free tier turns away anything
 * older than 1.18.0 (426), so keep this at or above that gate.
 */
export const DEFAULT_OPENCODE_VERSION = '1.19.0'

/**
 * codex_cli_rs latest release at port (openai/codex rust-v0.147.0, 2026-08-07).
 * Gateways match only the `codex_cli_rs/` prefix; the version stays truthful.
 */
export const DEFAULT_CODEX_CLI_VERSION = '0.147.0'

/**
 * codex_app desktop version (closed-source; measured date-style version, kept
 * as the default).
 */
export const DEFAULT_CODEX_DESKTOP_VERSION = '1.2026.0628'