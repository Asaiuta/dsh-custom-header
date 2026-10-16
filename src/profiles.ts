/**
 * Client-identity header profiles: complete header sets (User-Agent,
 * Originator, session ids, fingerprint stripping) mirroring real Codex /
 * Claude Code / opencode clients.
 *
 * All header values are real-world captures verified against openai/codex
 * source and gateway allowlists — nothing here is invented or inferred, including the opencode
 * `Identifier` id scheme (ascending `msg_`, descending `ses_`) and the Claude
 * Code 2.1.220 header set.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { ResolvedCustomHeaderConfig } from "./config.ts";
import {
	DEFAULT_CODEX_CLI_VERSION,
	DEFAULT_CODEX_DESKTOP_VERSION,
	DEFAULT_OPENCODE_VERSION,
} from "./defaults.ts";
import type { ConcreteProfileId, GatewayClientProfileId } from "./types.ts";

export interface GatewayHeaderProfile {
	id: GatewayClientProfileId;
	label: string;
	description: string;
	headers: Record<string, string>;
	/** Inject Anthropic Messages body fields (system + metadata.user_id). */
	patchAnthropicBody?: boolean;
	/**
	 * Headers that must be **removed** from the outgoing request (compared
	 * case-insensitively). pi/DSH adapters ride official SDKs that attach
	 * `X-Stainless-*` runtime fingerprint headers; real opencode (Bun +
	 * ai-sdk) sends none of them. A gateway that checks for their presence
	 * can unmask a disguised client instantly.
	 */
	dropHeaders?: string[];
}

/** OpenAI/Anthropic SDK runtime fingerprint headers — must be stripped when presenting as opencode. */
const STAINLESS_FINGERPRINT_HEADERS = [
	"x-stainless-retry-count",
	"x-stainless-timeout",
	"x-stainless-lang",
	"x-stainless-package-version",
	"x-stainless-os",
	"x-stainless-arch",
	"x-stainless-runtime",
	"x-stainless-runtime-version",
	"x-stainless-helper-method",
	"anthropic-dangerous-direct-browser-access",
	"sec-fetch-mode",
	"accept-language",
];

/**
 * Real codex_cli_rs User-Agent, reconstructed from openai/codex source
 * (codex-rs/login/src/auth/default_client.rs `get_codex_user_agent`):
 *
 *   {originator}/{CARGO_PKG_VERSION} ({os_type} {os_version}; {arch}) {terminal}
 *
 * os_info on Windows: os_type="Windows", version like "10.0.19045"; the
 * terminal token comes from codex-terminal-detection `user_agent()`, whose
 * Windows-Terminal value is "WindowsTerminal" (TERM would yield e.g.
 * "xterm-256color"). The pi plugin pinned a literal `terminal` token, which
 * no real Codex build emits — replaced here.
 */
export function buildCodexCliUserAgent(version: string): string {
	return `codex_cli_rs/${version} (Windows 10.0.19045; x86_64) WindowsTerminal`
}

/**
 * codex-tui: the interactive TUI front-end's real request identity.
 * openai/codex `is_first_party_originator` whitelists `codex-tui` and
 * official gateway UA-prefix lists include `codex-tui/`; the TUI
 * self-identifies as `client_name: "codex-tui"` (tui/src/lib.rs). Since the
 * UA prefix follows the process/thread originator (get_codex_user_agent),
 * interactive `codex` sessions send `codex-tui/...` — gateways show
 * "codex tui".
 */
export function buildCodexTuiUserAgent(version: string): string {
	return `codex-tui/${version} (Windows 10.0.19045; x86_64) WindowsTerminal`
}

/**
 * codex_app (desktop) UA. The `codex_app/` prefix + `Originator: codex_app`
 * are the identities gateway codex-family allowlists check. The desktop shell is
 * closed-source, so the full string is a measured capture kept as default;
 * override with `codexDesktopVersion`.
 */
export function buildCodexDesktopUserAgent(version: string): string {
	return `codex_app/${version} (Windows NT 10.0; Win64; x64)`
}

/**
 * Replicates opencode `Identifier` (packages/schema/src/identifier.ts):
 *   id = prefix + "_" + hex12(timestamp48) + base62(14)
 * where timestamp48 = (now*0x1000 + counter) masked to 48 bits. `msg_`
 * request ids are `Identifier.ascending()` (counter as-is); `ses_` session
 * ids are `Identifier.descending()` — the 48-bit value is bit-inverted so the
 * newest session sorts first. Zen's free tier rejects a `ses_` id whose low
 * 12 bits are not an inverted small counter (`0xfff - low < 16`), so the
 * inversion is load-bearing, not cosmetic.
 *
 * Total length 26 (12 hex timestamp chars + 14 random). The counter
 * increments within the same millisecond.
 */
const OPENCODE_ID_LENGTH = 26;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

let lastIdTimestamp = 0;
let idCounter = 0;

function randomBase62(length: number): string {
	const bytes = randomBytes(length);
	let out = "";
	for (let i = 0; i < length; i++) {
		out += BASE62[bytes[i] % 62];
	}
	return out;
}

function createOpencodeId(prefix: string, descending = false): string {
	const now = Date.now();
	if (now !== lastIdTimestamp) {
		lastIdTimestamp = now;
		idCounter = 0;
	}
	idCounter++;
	const value = BigInt(now) * 4096n + BigInt(idCounter);
	// Mask to 48 bits (12 hex), then bit-invert for descending ids so the
	// newest sorts first (and so the low 12 bits become an inverted counter).
	let timestamp48 = value & 0xffffffffffffn;
	if (descending) timestamp48 = 0xffffffffffffn - timestamp48;
	let hex = "";
	for (let i = 0; i < 6; i++) {
		const byte = Number((timestamp48 >> BigInt(40 - 8 * i)) & 255n);
		hex += byte.toString(16).padStart(2, "0");
	}
	return `${prefix}_${hex}${randomBase62(OPENCODE_ID_LENGTH - 12)}`;
}

/**
 * opencode session-scoped id. Measured: `x-opencode-session` reuses one
 * `ses_` id for the whole session, while `x-opencode-request` gets a fresh
 * `msg_` id per user message.
 *
 * Ids are allocated per session key (the DSH conversation's
 * `GenerateOptions.sessionId`): every conversation gets its own stable
 * `ses_` id on first use, matching the real opencode per-session behavior
 * instead of sharing one process-wide id across concurrent agents.
 */

const SESSION_IDS = new Map<string, { claude?: string; opencode?: string }>()

function sessionKeyOf(key: string | undefined): string {
	return key !== undefined && key.length > 0 ? key : 'default'
}

/** Reset every allocated session id (new session cadence). */
export function resetSessionIds(): void {
	SESSION_IDS.clear()
}

export function getOpencodeSessionId(key?: string): string {
	const entry = sessionEntry(key)
	if (!entry.opencode) {
		entry.opencode = createOpencodeId('ses', true)
	}
	return entry.opencode
}

function sessionEntry(key: string | undefined): { claude?: string; opencode?: string } {
	const k = sessionKeyOf(key)
	let entry = SESSION_IDS.get(k)
	if (!entry) {
		entry = {}
		SESSION_IDS.set(k, entry)
	}
	return entry
}

export function nextOpencodeRequestId(): string {
	return createOpencodeId("msg", false);
}

/**
 * opencode Zen request headers (measured capture, updated for 1.19.0).
 *
 * Measured POST /v1/chat/completions:
 *   User-Agent: opencode/1.19.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14
 *   x-opencode-client: cli
 *   x-opencode-project: global
 *   x-opencode-request: msg_ffb6895960014u17h4vCf7Dri4
 *   x-opencode-session: ses_…       (descending id; see createOpencodeId)
 *   x-opencode-session-id: ses_…    (same value as x-opencode-session)
 *
 * Note: the opencode provider branch does NOT send
 * x-session-affinity / X-Session-Id — that pair only appears for non-opencode
 * providers (LLMRequestPrep.prepare ternary branch in opencode source); since
 * mid-October 2026 Zen's free tier answers 403 FreeTierError when they are sent.
 */
function buildOpencodeZenHeaders(
	version: string,
	client: string,
	project: string,
	sessionKey?: string,
): Record<string, string> {
	const sessionId = getOpencodeSessionId(sessionKey);
	return {
		"User-Agent": `opencode/${version} ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14`,
		"x-opencode-client": client,
		"x-opencode-project": project,
		"x-opencode-session": sessionId,
		"x-opencode-session-id": sessionId,
		"x-opencode-request": nextOpencodeRequestId(),
	};
}

/**
 * Claude Code session-scoped UUID (`X-Claude-Code-Session-Id`).
 * Measured: the CLI generates one random UUID per session and reuses it.
 * Allocated per session key (see {@link getOpencodeSessionId}); the UUID
 * also feeds the body patch's `metadata.user_id` so header and body agree.
 */
export function getClaudeCodeSessionId(key?: string): string {
	const entry = sessionEntry(key)
	if (!entry.claude) {
		entry.claude = randomUUID()
	}
	return entry.claude
}

/**
 * @deprecated legacy user_id format (Claude Code 2.1.179 and earlier).
 * 2.1.220+ measures a JSON string {"device_id":"...","account_uuid":"","session_id":"..."}.
 * Kept for external compatibility; the body patch no longer uses it.
 */
export const CLAUDE_CODE_LEGACY_USER_ID =
	"user_0000000000000000000000000000000000000000000000000000000000000000_account_00000000-0000-0000-0000-000000000000_session_00000000-0000-0000-0000-000000000000";

export const CLAUDE_CODE_IDENTITY_SYSTEM =
	"You are a Claude agent, built on Anthropic's Claude Agent SDK.";

export function claudeCodeBillingSystemBlock(cliVersion: string): string {
	return [
		"x-anthropic-billing-header",
		`cc_version=${cliVersion}.0; cc_entrypoint=sdk-cli`,
	].join("\n");
}

export function buildClaudeCodeUserAgent(cliVersion: string): string {
	return `claude-cli/${cliVersion} (external, sdk-cli)`;
}

function buildClaudeCodeHeaders(
	cliVersion: string,
	anthropicBeta: string,
	sessionKey?: string,
): Record<string, string> {
	return {
		Accept: "application/json",
		"User-Agent": buildClaudeCodeUserAgent(cliVersion),
		"X-Claude-Code-Session-Id": getClaudeCodeSessionId(sessionKey),
		"X-Stainless-Arch": "x64",
		"X-Stainless-Lang": "js",
		"X-Stainless-OS": "Windows",
		"X-Stainless-Package-Version": "0.94.0",
		"X-Stainless-Retry-Count": "0",
		"X-Stainless-Runtime": "node",
		"X-Stainless-Runtime-Version": "v26.3.0",
		"X-Stainless-Timeout": "600",
		"X-App": "cli",
		"anthropic-version": "2023-06-01",
		"anthropic-beta": anthropicBeta,
		"anthropic-dangerous-direct-browser-access": "true",
	};
}

function buildConcreteProfiles(
	cliVersion: string,
	anthropicBeta: string,
	opencodeVersion: string = DEFAULT_OPENCODE_VERSION,
	opencodeClient = "cli",
	opencodeProject = "global",
	sessionKey?: string,
	codexCliVersion: string = DEFAULT_CODEX_CLI_VERSION,
	codexDesktopVersion: string = DEFAULT_CODEX_DESKTOP_VERSION,
): Record<ConcreteProfileId, GatewayHeaderProfile> {
	return {
		codex_official: {
			id: "codex_official",
			label: "Codex CLI (codex_cli_rs)",
			description:
				"Root Codex client: User-Agent prefix codex_cli_rs/ + Originator (headless / default transport; DEFAULT_ORIGINATOR in openai/codex).",
			headers: {
				"User-Agent": buildCodexCliUserAgent(codexCliVersion),
				Originator: "codex_cli_rs",
			},
		},
		codex_tui: {
			id: "codex_tui",
			label: "Codex TUI (codex-tui)",
			description:
				"Interactive TUI front-end identity: UA prefix codex-tui/ + Originator codex-tui (what interactive `codex` actually sends).",
			headers: {
				"User-Agent": buildCodexTuiUserAgent(codexCliVersion),
				Originator: "codex-tui",
			},
		},
		codex_desktop: {
			id: "codex_desktop",
			label: "Codex Desktop (codex_app)",
			description:
				"Desktop Codex: UA prefix codex_app/ + Originator codex_app (closed-source client; prefix + originator verified against gateway allowlists).",
			headers: {
				"User-Agent": buildCodexDesktopUserAgent(codexDesktopVersion),
				Originator: "codex_app",
			},
		},
		codex_claude_plugin: {
			id: "codex_claude_plugin",
			label: "Claude Code Codex plugin",
			description:
				"allow_claude_code_codex_plugin: Originator Claude Code + matching UA.",
			headers: {
				"User-Agent": "Claude Code/0.5.0 (Macos 15.5; arm64) iTerm2.app",
				Originator: "Claude Code",
			},
		},
		pi_agent: {
			id: "pi_agent",
			label: "pi_agent client",
			description: "pi_agent client identity (pi-coding-agent UA + Originator: pi; the server must also allow this identity).",
			headers: {
				"User-Agent": "pi-coding-agent/1.0",
				Originator: "pi",
			},
		},
		claude_code_messages: {
			id: "claude_code_messages",
			label: "Claude Code /v1/messages",
			description: `Claude CLI ${cliVersion} headers (sdk-cli) + X-Claude-Code-Session-Id + full anthropic-beta + body (user_id / system).`,
			headers: buildClaudeCodeHeaders(cliVersion, anthropicBeta, sessionKey),
			patchAnthropicBody: true,
		},
		opencode_zen: {
			id: "opencode_zen",
			label: "opencode Zen (x-opencode-*)",
			description: `opencode ${opencodeVersion} native headers: x-opencode-client/project/session/request + opencode UA (measured capture, for opencode Zen client restriction).`,
			headers: buildOpencodeZenHeaders(opencodeVersion, opencodeClient, opencodeProject, sessionKey),
			dropHeaders: STAINLESS_FINGERPRINT_HEADERS,
		},
	};
}

/** Profiles shown in selectors / diagnostics (order preserved). */
export const SELECTABLE_PROFILE_IDS: GatewayClientProfileId[] = [
	"auto",
	"off",
	"codex_official",
	"codex_tui",
	"codex_desktop",
	"codex_claude_plugin",
	"pi_agent",
	"claude_code_messages",
	"opencode_zen",
];

export interface ProfileMenuEntry {
	id: GatewayClientProfileId;
	label: string;
	description: string;
}

const AUTO_OFF_MENU: Record<"auto" | "off", ProfileMenuEntry> = {
	auto: {
		id: "auto",
		label: "auto",
		description:
			"Inject only when the request host matches gatewayHosts: Anthropic Messages paths → Claude; anything else → codexFallback. Empty gatewayHosts = no injection (safe default).",
	},
	off: {
		id: "off",
		label: "off",
		description: "No gateway client headers and no Anthropic body patch.",
	},
};

export function getProfileMenuEntries(config: ResolvedCustomHeaderConfig): ProfileMenuEntry[] {
	const profiles = buildConcreteProfiles(
		config.claudeCliVersion,
		config.anthropicBeta,
		config.opencodeVersion,
		config.opencodeClient,
		config.opencodeProject,
	);
	return SELECTABLE_PROFILE_IDS.map((id) => {
		if (id === "auto" || id === "off") {
			return AUTO_OFF_MENU[id];
		}
		const p = profiles[id];
		return { id: p.id, label: p.label, description: p.description };
	});
}

/** Exact host match or subdomain match (`example.com` covers `api.example.com`). */
export function hostMatchesGatewayHosts(host: string, hosts: string[]): boolean {
	const h = host.toLowerCase();
	return hosts.some((entry) => {
		const target = entry.toLowerCase().trim();
		if (!target) return false;
		return h === target || h.endsWith(`.${target}`);
	});
}

export interface RequestUrlInfo {
	hostname: string;
	pathname: string;
}

/**
 * anthropic-messages requests land on /v1/messages (with or without query).
 * The prefix-tolerant forms cover gateways whose baseUrl carries a path
 * segment (Anthropic SDK concatenates it: {baseUrl}/v1/messages), so the fetch layer must
 * recognize the protocol from the URL alone.
 */
export function isAnthropicMessagesUrl(url: RequestUrlInfo): boolean {
	return (
		url.pathname === "/v1/messages" ||
		url.pathname.startsWith("/v1/messages/") ||
		url.pathname.endsWith("/v1/messages")
	);
}

function buildProfiles(
	config: ResolvedCustomHeaderConfig,
	sessionKey?: string,
): Record<ConcreteProfileId, GatewayHeaderProfile> {
	return buildConcreteProfiles(
		config.claudeCliVersion,
		config.anthropicBeta,
		config.opencodeVersion,
		config.opencodeClient,
		config.opencodeProject,
		sessionKey,
		config.codexCliVersion,
		config.codexDesktopVersion,
	);
}

/**
 * Resolve which concrete profile applies for one request URL.
 *
 * `auto` rules:
 * - host matches, `/v1/messages*` (Anthropic Messages protocol) →
 *   claude_code_messages; anything else → codexFallback
 *
 * The host allowlist gates **every** profile, fixed ones included. The fetch
 * layer sees only the request URL — never which DSH provider or plugin owns
 * the request — so a host match is the only evidence that the request
 * belongs to a gateway this plugin was deployed for. Anything outside the
 * allowlist, and an empty allowlist, resolve to "no profile" (pass-through).
 *
 * `sessionKey` scopes the session-level ids (x-opencode-session,
 * X-Claude-Code-Session-Id) per DSH conversation.
 */
export function resolveProfileForUrl(
	profileId: GatewayClientProfileId,
	url: RequestUrlInfo | undefined,
	config: ResolvedCustomHeaderConfig,
	sessionKey?: string,
): GatewayHeaderProfile | undefined {
	if (profileId === "off") {
		return undefined;
	}

	// Uniform host gate — see the doc comment above.
	if (config.gatewayHosts.length === 0) {
		return undefined;
	}
	if (!url) {
		return undefined;
	}
	if (!hostMatchesGatewayHosts(url.hostname, config.gatewayHosts)) {
		return undefined;
	}

	const profiles = buildProfiles(config, sessionKey);
	const concrete =
		profileId === "auto"
			? isAnthropicMessagesUrl(url)
				? profiles.claude_code_messages
				: profiles[config.codexFallback]
			: profiles[profileId as ConcreteProfileId];

	return applyExtraHeaders(concrete, config.extraHeaders);
}

function applyExtraHeaders(
	profile: GatewayHeaderProfile | undefined,
	extra: Record<string, string>,
): GatewayHeaderProfile | undefined {
	if (!profile) {
		return undefined;
	}
	if (!extra || Object.keys(extra).length === 0) {
		return profile;
	}
	return {
		...profile,
		headers: { ...profile.headers, ...extra },
	};
}

/** Human-readable reason when nothing injects (for diagnostics). */
export function describeEffectiveProfile(
	profileId: GatewayClientProfileId,
	url: RequestUrlInfo | undefined,
	config: ResolvedCustomHeaderConfig,
): string {
	const profile = resolveProfileForUrl(profileId, url, config);
	if (profile) return profile.id;

	if (profileId === "off") return "off";
	if (config.gatewayHosts.length === 0) {
		return "off (empty gatewayHosts: safe default, no injection)";
	}
	if (!url) {
		return "off (no request URL information)";
	}
	if (!hostMatchesGatewayHosts(url.hostname, config.gatewayHosts)) {
		return "off (request host not in gatewayHosts)";
	}

	return "off (no effective preset)";
}