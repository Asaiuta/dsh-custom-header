/**
 * Gateway client-signature profile ids and guards.
 *
 * The profile vocabulary, host matching, and resolution rules follow the
 * gateway client-restriction vocabulary. DSH has no per-request header
 * hook, so the fetch transport layer only sees the request URL. `resolveProfileForUrl()` maps the URL onto the same
 * semantics (anthropic-messages ↔ `/v1/messages*`, openai family otherwise).
 */
export type GatewayClientProfileId =
	| "auto"
	| "off"
	| "codex_official"
	| "codex_tui"
	| "codex_desktop"
	| "codex_claude_plugin"
	| "pi_agent"
	| "claude_code_messages"
	| "opencode_zen";

/** The Codex identities the `auto` profile may fall back to (config `codexFallback`). */
export type CodexFallbackId = "codex_official" | "codex_tui" | "codex_desktop" | "codex_claude_plugin";

export type ConcreteProfileId = Exclude<GatewayClientProfileId, "auto" | "off">;

const PROFILE_IDS: readonly GatewayClientProfileId[] = [
	"auto",
	"off",
	"codex_official",
	"codex_tui",
	"codex_desktop",
	"codex_claude_plugin",
	"pi_agent",
	"claude_code_messages",
	"opencode_zen",
] as const;


export function isGatewayClientProfileId(value: string): value is GatewayClientProfileId {
	return (PROFILE_IDS as readonly string[]).includes(value);
}

/** The subset of profiles the `auto` path may select for OpenAI-family requests. */
export function isCodexFallbackId(value: string): value is CodexFallbackId {
	return (
		value === "codex_official" ||
		value === "codex_tui" ||
		value === "codex_desktop" ||
		value === "codex_claude_plugin"
	);
}