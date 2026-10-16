/**
 * dsh-custom-header transport smoke test.
 *
 * Boots one local HTTP capture server and verifies the fetch pipeline
 * behaves like the pi extension's measured behavior, plus the 0.4.0
 * uniform-gating rule (fixed profiles are host-allowlisted too):
 *   1. auto profile + gatewayHosts match: URL rewrite + Claude headers + body patch
 *   2. auto profile: Codex fallback preset on chat/completions
 *   3. opencode_zen fixed profile: per-request msg id, stable session id,
 *      X-Stainless fingerprint headers stripped
 *   4. auto profile, host outside gatewayHosts: nothing touched
 *   5. off profile: nothing touched
 *   6. per-conversation session id isolation
 *   7. prefixed /v1/messages routes to the Claude profile
 *   8. codex_tui preset identity
 *   9. fixed profile: gated by gatewayHosts exactly like auto (the 0.4.0
 *      behavior change — a fixed profile is not global)
 *
 * Usage: node tests/smoke.mjs
 *
 * Set SMOKE_LIB to a bundle path to test a build without touching `lib/`
 * (useful while a live desktop app watches the mounted plugin):
 *   esbuild src/index.ts --bundle --format=esm --platform=node --target=node22 \
 *     --external:@deepseek-ai/* --outfile=%TEMP%/dch-smoke/index.js
 *   set SMOKE_LIB=%TEMP%/dch-smoke/index.js && node tests/smoke.mjs
 */
import http from 'node:http'
import { pathToFileURL } from 'node:url'

// Save the pristine fetch before the pipeline patches globalThis (the
// pipeline's accessor replacement makes undici's teardown assert on exit).
const originalFetchDesc = Object.getOwnPropertyDescriptor(globalThis, 'fetch')

// The plugin's session-context singleton: the llm/stream wrapper runs adapter
// iterations inside it, and the fetch middlewares read it back. The smoke
// harness drives it directly around fetch to simulate that wrapper.
const libUrl = process.env.SMOKE_LIB
  ? pathToFileURL(process.env.SMOKE_LIB).href
  : new URL('../lib/index.js', import.meta.url).href

const {
  requestSessionContext,
  registerFetchMiddleware,
  createUrlRewriteMiddleware,
  createHeaderStripMiddleware,
  createHeaderInjectMiddleware,
  createBodyPatchMiddleware,
  normalizeCustomHeaderConfig,
} = await import(libUrl)

function startCaptureServer() {
  const captured = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      captured.push({ url: req.url, headers: req.headers, body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, captured })
    })
  })
}

function configure(configOverrides) {
  const config = normalizeCustomHeaderConfig(configOverrides)
  const state = { profile: config.profile, config }
  registerFetchMiddleware({
    name: 't-url', priority: 5,
    middleware: createUrlRewriteMiddleware(() => ({ enabled: state.profile !== 'off', hosts: state.config.gatewayHosts, rewrites: state.config.urlRewrites })),
  })
  registerFetchMiddleware({
    name: 't-strip', priority: 6,
    middleware: createHeaderStripMiddleware(() => ({ profile: state.profile, config: state.config })),
  })
  registerFetchMiddleware({
    name: 't-inject', priority: 7,
    middleware: createHeaderInjectMiddleware(() => ({ profile: state.profile, config: state.config })),
  })
  registerFetchMiddleware({
    name: 't-body', priority: 8,
    middleware: createBodyPatchMiddleware(() => ({ profile: state.profile, config: state.config })),
  })
  return state
}

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const gated = await startCaptureServer()

// ---- scenario 1: auto + anthropic messages + rewrite + body patch ----
configure({ profile: 'auto', gatewayHosts: ['127.0.0.1'], urlRewrites: { '/v1/messages': { appendQuery: 'beta=true' } } })
const base = `http://127.0.0.1:${gated.port}`
await fetch(`${base}/v1/messages?stream=true`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
})
const r1 = gated.captured.at(-1)
check('s1 url rewrite appended query', r1.url === '/v1/messages?stream=true&beta=true', r1.url)
check('s1 claude UA injected', String(r1.headers['user-agent']).startsWith('claude-cli/2.1.220'), r1.headers['user-agent'])
check('s1 X-Claude-Code-Session-Id present', /^[0-9a-f-]{36}$/.test(String(r1.headers['x-claude-code-session-id'])), r1.headers['x-claude-code-session-id'])
check('s1 anthropic-version injected', r1.headers['anthropic-version'] === '2023-06-01', String(r1.headers['anthropic-version']))
const body1 = JSON.parse(r1.body)
check('s1 body patched with system block', Array.isArray(body1.system) && body1.system[0].text.startsWith('You are a Claude agent'), JSON.stringify(body1.system))
check('s1 body patched with user_id', typeof body1.metadata?.user_id === 'string' && body1.metadata.user_id.includes('device_id'), body1.metadata?.user_id)

// ---- scenario 2: auto + codex fallback on chat completions ----
await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
})
const r2 = gated.captured.at(-1)
check('s2 codex UA injected (real CLI format)', String(r2.headers['user-agent']) === 'codex_cli_rs/0.147.0 (Windows 10.0.19045; x86_64) WindowsTerminal', r2.headers['user-agent'])
check('s2 originator injected', r2.headers['originator'] === 'codex_cli_rs', String(r2.headers['originator']))
const body2 = JSON.parse(r2.body)
check('s2 body untouched (no metadata)', body2.metadata === undefined, JSON.stringify(body2.metadata))

// ---- scenario 3: opencode_zen fixed profile (per-request ids + strip) ----
configure({ profile: 'opencode_zen', gatewayHosts: ['127.0.0.1'], opencodeVersion: '1.18.18' })
const zenHeaders = []
for (let i = 0; i < 2; i++) {
  await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Stainless-Lang': 'js', 'X-Stainless-Runtime-Version': 'v26.3.0', 'accept-language': 'zh-CN' },
    body: JSON.stringify({ model: 'deepseek-v4', messages: [{ role: 'user', content: 'hi' }] }),
  })
  zenHeaders.push(gated.captured.at(-1).headers)
}
check('s3 opencode UA injected', String(zenHeaders[0]['user-agent']).startsWith('opencode/1.18.18'), zenHeaders[0]['user-agent'])
check('s3 x-opencode-client injected', zenHeaders[0]['x-opencode-client'] === 'cli', zenHeaders[0]['x-opencode-client'])
check('s3 session id stable across requests', zenHeaders[0]['x-opencode-session'] === zenHeaders[1]['x-opencode-session'], `${zenHeaders[0]['x-opencode-session']} vs ${zenHeaders[1]['x-opencode-session']}`)
check('s3 request id regenerated per request', zenHeaders[0]['x-opencode-request'] !== zenHeaders[1]['x-opencode-request'], `${zenHeaders[0]['x-opencode-request']} vs ${zenHeaders[1]['x-opencode-request']}`)
check('s3 request id has opencode shape', /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(String(zenHeaders[0]['x-opencode-request'])), zenHeaders[0]['x-opencode-request'])
check('s3 stainless headers stripped', zenHeaders[0]['x-stainless-lang'] === undefined && zenHeaders[1]['x-stainless-runtime-version'] === undefined, JSON.stringify(zenHeaders[0]))
// Known limitation ported from the pi extension: Node's undici injects
// accept-language / sec-fetch-mode BELOW fetch — the extension layer cannot
// remove them (verified there too). Gateway checks rarely look at these.
if (zenHeaders[0]['accept-language'] !== undefined) {
  console.log('  note s3 accept-language is a known undici-injected residual (unremovable at fetch layer)')
}

// ---- scenario 4: host outside gatewayHosts untouched ----
// 'localhost' resolves to the same server but its hostname is not in
// gatewayHosts ('127.0.0.1'), so nothing may be touched.
const off = `http://localhost:${gated.port}`
await fetch(`${off}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
})
const r4 = gated.captured.at(-1)
check('s4 no UA injection outside gatewayHosts', !String(r4.headers['user-agent'] ?? '').startsWith('codex_'), r4.headers['user-agent'])
check('s4 no originator outside gatewayHosts', r4.headers['originator'] === undefined, String(r4.headers['originator']))

// ---- scenario 5: off profile ----
configure({ profile: 'off', gatewayHosts: ['127.0.0.1'] })
await fetch(`${base}/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
})
const r5 = gated.captured.at(-1)
check('s5 off profile: no rewrite', r5.url === '/v1/messages', r5.url)
check('s5 off profile: no claude UA', !String(r5.headers['user-agent'] ?? '').startsWith('claude-cli'), r5.headers['user-agent'])

// ---- scenario 6: per-conversation session id isolation ----------------
// Ported behavior must scope x-opencode-session per DSH conversation instead
// of sharing one process-wide id (pi is single-session; DSH is not).
configure({ profile: 'opencode_zen', gatewayHosts: ['127.0.0.1'], opencodeVersion: '1.18.18' })
const sendZen = () =>
  fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4', messages: [{ role: 'user', content: 'hi' }] }),
  }).then(() => gated.captured.at(-1).headers['x-opencode-session'])

const sesDefault = await sendZen()                                 // no context = 'default' session
const sesA1 = await requestSessionContext.run('conv-a', () => sendZen())             // conversation A
const sesB = await requestSessionContext.run('conv-b', () => sendZen())              // conversation B
const sesA2 = await requestSessionContext.run('conv-a', () => sendZen())             // A again — stable
const sesDefault2 = await sendZen()                                // default again — stable
check('s6 default session stable', sesDefault === sesDefault2, `${sesDefault} vs ${sesDefault2}`)
check('s6 A stable across requests', sesA1 === sesA2, `${sesA1} vs ${sesA2}`)
check('s6 A/B isolated', sesA1 !== sesB, `${sesA1} vs ${sesB}`)
check('s6 A differs from default', sesA1 !== sesDefault, `${sesA1} vs ${sesDefault}`)

// ---- scenario 7: anthropic protocol with a prefixed gateway path ------
// pi decides by model.api (path-independent); the fetch layer must recognize
// {baseUrl}/v1/messages prefixed routes the same way.
configure({ profile: 'auto', gatewayHosts: ['127.0.0.1'] })
await fetch(`${base}/proxy/anthropic/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
})
const r7 = gated.captured.at(-1)
check('s7 prefixed /v1/messages routes to Claude profile', String(r7.headers['user-agent']).startsWith('claude-cli/2.1.220'), r7.headers['user-agent'])
const body7 = JSON.parse(r7.body)
check('s7 prefixed path body patched', Array.isArray(body7.system) && body7.system.length >= 1, JSON.stringify(body7.system))

// ---- scenario 8: codex_tui preset (the TUI front-end's real identity) ----
// Interactive `codex` sessions send codex-tui/ UA + Originator: codex-tui
// (openai/codex is_first_party_originator whitelist + TUI client_name).
configure({ profile: 'codex_tui', gatewayHosts: ['127.0.0.1'] })
await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'deepseek-v4', messages: [{ role: 'user', content: 'hi' }] }),
})
const r8 = gated.captured.at(-1)
check('s8 codex-tui UA injected', String(r8.headers['user-agent']) === 'codex-tui/0.147.0 (Windows 10.0.19045; x86_64) WindowsTerminal', r8.headers['user-agent'])
check('s8 codex-tui originator', r8.headers['originator'] === 'codex-tui', String(r8.headers['originator']))

// ---- scenario 9: fixed profiles are host-allowlisted too (0.4.0) ------
// In 0.1.x a fixed profile injected globally; since 0.4.0 every profile —
// fixed ones included — goes through the same gatewayHosts gate. A fixed
// profile must touch its listed host and leave every other host alone.
configure({ profile: 'claude_code_messages', gatewayHosts: ['127.0.0.1'] })
await fetch(`${base}/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
})
const r9in = gated.captured.at(-1)
check('s9 fixed profile injects on listed host', String(r9in.headers['user-agent']).startsWith('claude-cli/'), r9in.headers['user-agent'])

await fetch(`${off}/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
})
const r9out = gated.captured.at(-1)
check('s9 fixed profile untouched outside gatewayHosts', !String(r9out.headers['user-agent'] ?? '').startsWith('claude-cli'), r9out.headers['user-agent'])
const body9out = JSON.parse(r9out.body)
check('s9 no body patch outside gatewayHosts', body9out.system === undefined, JSON.stringify(body9out.system))

gated.server.closeAllConnections?.()
gated.server.close()
gated.server.closeAllConnections?.()
gated.server.close()

// Restore pristine fetch so process teardown does not trip over the patch.
if (originalFetchDesc) {
  Object.defineProperty(globalThis, 'fetch', originalFetchDesc)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)