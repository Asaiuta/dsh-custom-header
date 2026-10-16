/**
 * opencode Zen free-tier compatibility, applied by the body-patch fetch
 * middleware (`body-patch.ts`).
 *
 * Since mid-October 2026 opencode's Zen free tier hard-restricts requests
 * beyond the header layer (see the magpie reverse-engineering, magpie
 * `internal/provider/opencode_client.go`):
 *
 *   - free models must hit `/inference/v1/…`, not `/zen/v1/…`
 *     (`403 FreeTierError` otherwise);
 *   - a streamed free-tier request must *offer* tools named `bash` and
 *     `read`, each carrying a non-empty parameters schema (a bare
 *     `{"type":"object"}` answers `403 FreeTierError`);
 *   - identity: the request must already look like opencode (opencode UA +
 *     `x-opencode-*`), which the `opencode_zen` profile supplies.
 *
 * These are applied only when all three hold: `opencodeZenFree` is enabled,
 * the resolved profile is `opencode_zen` (host in gatewayHosts), and the body's
 * model id is a known free one.
 */

const ZEN_FREE_SUFFIX = '-free'

/** Zen free models whose ids don't end in `-free` (magpie `openCodeFreeIDs`). */
const ZEN_KNOWN_FREE_MODELS = new Set(['big-pickle', 'grok-code'])

/** opencode's own tool schemas, as the real 1.19.0 client sends them. */
const ZEN_BASH_SCHEMA = {
	type: 'object',
	properties: {
		command: { type: 'string', description: 'The command to execute' },
		timeout: { type: 'integer', description: 'Optional timeout in milliseconds' },
		workdir: { type: 'string', description: 'The working directory to run the command in' },
	},
	required: ['command'],
}

const ZEN_READ_SCHEMA = {
	type: 'object',
	properties: {
		filePath: { type: 'string', description: 'The absolute path to the file or directory to read' },
		offset: { type: 'integer', description: 'The line number to start reading from (1-indexed)' },
		limit: { type: 'integer', description: 'The maximum number of lines to read' },
	},
	required: ['filePath'],
}

/** The tool stub opencode offers Zen's free tier: present, never callable. */
const ZEN_TOOL_STUB = 'Not available in this session. Never call this tool.'

function modelId(model: string): string {
	return model.split('/').pop() ?? model
}

/** Whether `model` is one of Zen's free-tier models. */
export function isOpencodeFreeModel(model: string): boolean {
	const id = modelId(model).toLowerCase()
	return id.endsWith(ZEN_FREE_SUFFIX) || ZEN_KNOWN_FREE_MODELS.has(id)
}

/**
 * Rewrite a Zen free-tier endpoint: `opencode.ai` (or `*.opencode.ai`) paths
 * under `/zen` (except `/zen/go`, the Go gateway) become `/inference`. Other
 * URLs are returned unchanged.
 */
export function rewriteOpencodeZenUrl(url: URL): URL {
	const host = url.hostname.toLowerCase()
	if (host !== 'opencode.ai' && !host.endsWith('.opencode.ai')) return url
	const path = url.pathname
	if (!path.startsWith('/zen')) return url
	const rest = path.slice('/zen'.length)
	if (rest !== '' && !rest.startsWith('/')) return url
	if (rest === '/go' || rest.startsWith('/go/')) return url
	url.pathname = '/inference' + rest
	return url
}

/**
 * Ensure an OpenAI chat-completions body satisfies the free tier: `stream`
 * and the `bash`/`read` tool stubs. Replaces `tools` (the free tier checks
 * that these two are offered, not that the client uses them).
 */
export function patchOpencodeZenFreeBody(body: Record<string, unknown>): Record<string, unknown> {
	return {
		...body,
		stream: true,
		tools: [
			{
				type: 'function',
				function: { name: 'bash', description: ZEN_TOOL_STUB, parameters: ZEN_BASH_SCHEMA },
			},
			{
				type: 'function',
				function: { name: 'read', description: ZEN_TOOL_STUB, parameters: ZEN_READ_SCHEMA },
			},
		],
	}
}