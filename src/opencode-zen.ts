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
 *
 * The gate asks that the two names be *offered*, so the stubs are **appended**
 * to whatever `tools` the caller already sent, and a name is skipped when the
 * caller already offers it. 0.4.0 replaced the whole array instead, which left
 * the model holding two stubs and none of its real tools — models that guessed
 * real names (`ops_bash`, `ff_read`) from the system prompt kept working, models
 * that took the stub text at face value refused outright, and a model that
 * called the stub name itself got `unknown tool "bash"`. The stub wording stays
 * as it is for that last reason: its job is to suppress calls to a name DSH does
 * not serve. The bug was that it was the *only* thing on offer.
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
export const ZEN_TOOL_STUB = 'Not available in this session. Never call this tool.'

/** The two names the free tier insists on seeing offered. */
export const ZEN_BASH_TOOL_NAME = 'bash'
export const ZEN_READ_TOOL_NAME = 'read'

function modelId(model: string): string {
	return model.split('/').pop() ?? model
}

/** Every `function.name` already offered by a `tools` array, for de-duplication. */
function offeredToolNames(tools: unknown): Set<string> {
	const names = new Set<string>()
	if (!Array.isArray(tools)) return names
	for (const tool of tools) {
		if (typeof tool !== 'object' || tool === null) continue
		const fn = (tool as { function?: unknown }).function
		if (typeof fn !== 'object' || fn === null) continue
		const name = (fn as { name?: unknown }).name
		if (typeof name === 'string' && name !== '') names.add(name)
	}
	return names
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
 * Make an OpenAI chat-completions body satisfy the free tier: `stream`, plus
 * the `bash`/`read` tool stubs the gate looks for.
 *
 * The caller's own `tools` are preserved and the stubs are appended — the gate
 * checks that these two are *offered*, not that they are the only ones. A name
 * already present is left alone rather than duplicated, so a caller that really
 * does offer `read` keeps its own schema.
 */
export function patchOpencodeZenFreeBody(body: Record<string, unknown>): Record<string, unknown> {
	const tools = Array.isArray(body.tools) ? [...body.tools] : []
	const offered = offeredToolNames(tools)
	const stubs: Record<string, unknown>[] = []
	if (!offered.has(ZEN_BASH_TOOL_NAME)) {
		stubs.push({
			type: 'function',
			function: { name: ZEN_BASH_TOOL_NAME, description: ZEN_TOOL_STUB, parameters: ZEN_BASH_SCHEMA },
		})
	}
	if (!offered.has(ZEN_READ_TOOL_NAME)) {
		stubs.push({
			type: 'function',
			function: { name: ZEN_READ_TOOL_NAME, description: ZEN_TOOL_STUB, parameters: ZEN_READ_SCHEMA },
		})
	}
	return { ...body, stream: true, tools: [...tools, ...stubs] }
}