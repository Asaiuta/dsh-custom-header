# dsh-custom-header

**Outbound LLM request modification for DeepSeek Harness (DSH), at the fetch transport layer.**

One `globalThis.fetch` middleware chain (keyed by a DSH-scoped symbol,
`Symbol.for("dsh-custom-header.fetch.pipeline.v1")`) that every provider —
whatever plugin owns it — streams through:

- **injects** client-identity headers (`User-Agent`, `Originator`,
  `X-Claude-Code-Session-Id`, `x-opencode-*`, …) from presets that mirror real
  Codex / Claude Code / opencode clients
- **strips** `X-Stainless-*` runtime fingerprint headers
- **rewrites** the request URL (path matching + `appendQuery`)
- **patches** request bodies: the Anthropic Messages identity / billing system
  block + `metadata.user_id`, and the opencode Zen free-tier tool stubs

> For servers you administer or are authorized to use. Cloudflare TLS/Bot
> edge blocks need a different API entry, an admin allowlist, or a local
> forward proxy.

## Why fetch, not a provider-owning adapter

The 0.2/0.3 line rewrote this plugin as provider-owning `LlmAdapter`s
registered through `ctx.llm.registerAdapter(routes, adapter)`. That extension
point is **per-route exclusive**: registering a route another plugin already
owns (say the `ziyong`/`moonshotai` providers that `llm-pi-ai` registers)
throws `DUPLICATE_ADAPTER`, and the host exposes no way to graft onto someone
else's adapter. The point of this plugin is exactly "make requests to *my*
gateway look like client X" — whatever plugin those requests come from — so it
needs a seat that owns no routes at all. The fetch layer is that seat: it
intercepts the transport every adapter already uses.

The cost of the fetch seat is that only the request URL identifies a request
(never the owning provider). So the `gatewayHosts` allowlist is the single safety
boundary: **every profile — fixed ones included — touches only requests whose
host matches**, and an empty allowlist is a safe no-op.

## How it works

`apply` registers four middlewares into the shared pipeline, each re-reading a
snapshot that `loader/volatile-update` refreshes (a settings save therefore
lands in the next request — no restart):

| priority | middleware | what it does |
|---|---|---|
| 5 | `url-rewrite` | path matching + `appendQuery` / replacement, host-gated |
| 6 | `header-strip` | `X-Stainless-*` and runtime fingerprint removal, on profiles that ask for it |
| 7 | `header-inject` | the resolved profile's identity headers + `extraHeaders` |
| 8 | `body-patch` | Anthropic identity body patch; opencode Zen `/zen` → `/inference` + `bash`/`read` tool stubs (free models only) |

The chain mechanics: an accessor `fetch` on `globalThis` whose setter keeps the
underlying fetch in sync; middlewares compose on every (re)install, priority
ascending; each receives `{ input, init, next }` and may call `next` with
rewritten input. The pipeline is vendored from
[`@aizigao/pi-fetch-pipeline`](https://github.com/aizigao/pi-fetch-pipeline)
(MIT), re-keyed for DSH so multiple plugins can coexist without clobbering each
other's chains.

Session-scoped ids (`x-opencode-session`, `X-Claude-Code-Session-Id`,
`metadata.user_id`) cannot be read from a URL, so the plugin wraps the
`llm/stream` waterfall: every adapter stream iteration — including the fetch it
issues — runs inside an `AsyncLocalStorage` carrying
`GenerateOptions.sessionId`. That is what keeps concurrent DSH conversations
from sharing one process-wide id. The same observer logs a 403 hint
distinguishing Cloudflare HTML edge blocks from JSON client-restriction
rejections.

Configuration is a schemastery `Config` schema on the plugin, validated by the
Loader against `cordis.yml`. **Every field is `.volatile()`**, which is what
makes `dsh-settings` publish a writable namespace for the entry at all: its
`describe()` collects only entries carrying a volatile field, and its writer
rejects any other path. A volatile-only change is committed into the running
fiber rather than remounting it — the host half re-reads its refs on
`loader/volatile-update` instead of snapshotting at mount.

The page itself is the plugin's own browser half (`src/client/*`). It registers
as a **section of the Settings panel** (`settings.section`) and, as a second
seat, on the bundle's own row in the **Plugins page**
(`plugins.row.config`) — see **Configuration page** below.

| concern | where |
|---|---|
| middleware registration + diagnostics | `index.ts` |
| fetch pipeline (vendored, symbol-keyed) | `fetch-pipeline.ts` |
| header injection / stripping | `header-inject.ts` |
| profile resolution + presets | `profiles.ts` |
| Anthropic body patch + Zen free tier wiring | `body-patch.ts` |
| opencode Zen helpers | `opencode-zen.ts` |
| URL rewrite | `url-rewrite.ts` |
| per-conversation session ids | `session-context.ts` (AsyncLocalStorage) |
| 403 diagnostics | `index.ts` + `response-hints.ts` |
| settings schema (all volatile) | `config.ts` (`ConfigSchema`, schemastery) |
| configuration page | `client/index.tsx` (`settings.section` + `plugins.row.config`) |
| scenario tabs → staged `profile` | `client/scenarios.ts` |
| page copy (zh / en) | `client/locales.ts` |
| page controls + field specs | `client/fields.tsx` |
| page stylesheet | `client/styles.ts` |

Safe default: `profile: "off"`, or an empty `gatewayHosts` — either way nothing is
injected, stripped, rewritten or patched.

## Profiles

Each fixed profile is a complete client-identity header set:

| Profile | Headers sent |
|---|---|
| `codex_desktop` | `codex_app/1.2026.0628 (Windows NT 10.0; Win64; x64)` + `Originator: codex_app` |
| `codex_official` | `codex_cli_rs/0.147.0 (Windows 10.0.19045; x86_64) WindowsTerminal` + `Originator: codex_cli_rs` |
| `codex_tui` | `codex-tui/0.147.0 (…; x86_64) WindowsTerminal` + `Originator: codex-tui` |
| `codex_claude_plugin` | `Claude Code/0.5.0 (Macos 15.5; arm64) iTerm2.app` + `Originator: Claude Code` |
| `pi_agent` | `pi-coding-agent/1.0` + `Originator: pi` (needs the server to accept this identity too) |
| `claude_code_messages` | `claude-cli/2.1.220 (external, sdk-cli)` + `X-Claude-Code-Session-Id` + full `anthropic-beta` + body (`metadata.user_id` JSON / system block) |
| `opencode_zen` | `opencode/1.19.0 ai-sdk/...` UA + `x-opencode-client/project/session/session-id/request` (descending `ses_` id) |
| `auto` | on a matching host: Anthropic `/v1/messages` paths → Claude set; anything else → `codexFallback` |
| `off` | nothing |

All profiles — fixed ones included — are gated by `gatewayHosts`. The Codex header
values are verified against openai/codex source (see "Truthfulness
verification"); the opencode `Identifier` id scheme (`msg_` ascending / `ses_`
descending, `hex12` + base62) and the Claude Code 2.1.220 header set are
re-implemented from their real-world formats.

## Truthfulness verification (Codex presets)

Codex identity fields were checked against primary sources:

- **`Originator: codex_cli_rs`** — openai/codex
  `codex-rs/login/src/auth/default_client.rs`: `DEFAULT_ORIGINATOR = "codex_cli_rs"`.
- **codex_official UA shape** — same file, `get_codex_user_agent()`:
  `{originator}/{CARGO_PKG_VERSION} ({os_type} {os_version}; {arch}) {terminal}`,
  with the terminal token from `codex-rs/terminal-detection/src/lib.rs`
  (`WindowsTerminal` for Windows Terminal, `xterm-256color` from `TERM`, …).
  A literal `terminal` tail matches no real build and was replaced.
  `0.147.0` is the current release (rust-v0.147.0, 2026-08-07).
- **codex_cli_rs vs codex-tui** — the CLI has several first-party front-ends.
  `default_client.rs` sets `DEFAULT_ORIGINATOR = "codex_cli_rs"` and builds the
  UA from the process originator, but `is_first_party_originator` also
  whitelists `codex-tui` and `codex_vscode`, and the TUI self-identifies as
  `client_name: "codex-tui"` (`tui/src/lib.rs`). Interactive `codex` sessions
  therefore actually send `codex-tui/…` UA + `Originator: codex-tui`.
  Profiles `codex_official` (headless/default) and `codex_tui` (interactive
  TUI) cover both.
- **`codex_app/` + `Originator: codex_app`** — the desktop shell is
  closed-source; `codex_app` is the client family's own identity string.
  The full UA is a measured capture; override via `codexDesktopVersion`.
- **codex_claude_plugin UA** — Claude Code UA format
  (`Claude Code/x.y.z (OS; arch) Terminal`); 0.5.0 is an old but real
  version. Server checks only match the prefix, so the value is kept
  conservative.

## Install

```bash
dsh plugin --profile web add file:$(pwd)     # or: dsh plugin add dsh-custom-header
```

Verify: look for the `dsh-custom-header loaded: ...` diagnostics in the server
log, or inspect `ctx.dshCustomHeader.status()`.

## Config (`cordis.yml`)

```yaml
dsh-custom-header:
  profile: auto             # auto | off | codex_desktop | codex_official | codex_tui | codex_claude_plugin | pi_agent | claude_code_messages | opencode_zen
  gatewayHosts:
    - gateway.example.com   # the allowlist: EVERY profile only touches these hosts; subdomains match; empty = no-op
  codexFallback: codex_desktop
  codexCliVersion: 0.147.0
  codexDesktopVersion: 1.2026.0628
  claudeCliVersion: 2.1.220
  # anthropicBeta: "claude-code-20250219,interleaved-thinking-2025-05-14,…"  # anthropic-beta header (claude_code_messages)
  opencodeVersion: 1.19.0
  opencodeClient: cli
  opencodeProject: global
  # opencode Zen free tier (needs profile: opencode_zen and a free model):
  opencodeZenFree: false        # /zen → /inference + bash/read tool stubs
  claudeSystemBlock: identity    # identity | billing
  extraHeaders: {}              # merged onto every profile
  urlRewrites:
    /v1/messages:
      appendQuery: beta=true    # servers that strictly check ?beta=true
```

Point your provider's own base URL at the gateway as usual — this plugin never
touches provider configuration; it intercepts the requests that provider makes.

## Configuration page

The page is a **section of the Settings panel**: *Settings → Custom header*, a
nav row of its own beside General / Models / Plugins, registered into the
`settings.section` slot.

The page is a nav rail plus three stable pages (the shell follows
`dsh-any-background`'s settings section). Every field has exactly one home, and
switching pages never reclassifies a row — a field that relocated while being
edited was the exact weirdness this layout removed:

| page | fields |
| --- | --- |
| Identity & gateway | `gatewayHosts`, `codexFallback`, `claudeSystemBlock` |
| Version headers | `claudeCliVersion`, `codexCliVersion`, `codexDesktopVersion`, `anthropicBeta`, `opencodeVersion`, `opencodeClient`, `opencodeProject`, `opencodeZenFree` |
| Advanced | `extraHeaders`, `urlRewrites` |

The identity page opens on a **scenario picker**, not on a list of fields.
Accurate field names describe the *config*; they do not describe the *job*.
Nobody arrives wanting to set `gatewayHosts` — they arrive wanting Codex, or
Claude Code, or opencode, or the pi agent, to reach their own gateway. Each tab
is one of those intents, and picking it stages the `profile` that makes the
intent real:

| scenario | stages `profile` |
| --- | --- |
| Auto | `auto` |
| Codex | `codex_official` / `codex_tui` / `codex_desktop` / `codex_claude_plugin` (a second-level choice) |
| Claude | `claude_code_messages` |
| pi | `pi_agent` |
| opencode | `opencode_zen` |
| Off | `off` |

Only the active page's fields are rendered, so one field is mounted exactly once
and each control's DOM id stays unique.

### Controls

Each field is drawn with the host control its shape calls for:

| field shape | control | |
| --- | --- | --- |
| one-line text | `SettingsValueField` | draws its own label, overridden badge, reset, invalid copy and `help` region |
| 2–4 fixed values | `SegmentedControl` | `claudeSystemBlock`, `codexFallback`, the Codex variant |
| boolean | `Switch` | `opencodeZenFree` |
| string list / JSON object | `textarea` | the page's own — the host ships no multiline row |

The long explanations live behind each row's **?** button rather than under it,
which is what lets the always-visible `hint` stay one line.

The same form is registered a second time on the **Plugins page**, on the
bundle's own row (*Plugins → dsh-custom-header*, the row's **Configure**
control), through `plugins.row.config`. That is where the host's slot contract
puts a third party *bundle*'s configuration; the Settings section is where a
user actually goes looking for it.

Nothing is written as you type: the page stages a draft and **Save** is the only
thing that mutates the settings document, revision-fenced against a concurrent
change elsewhere. Picking a scenario is one more staged edit and follows the same
rule — it lands on Save and Discard undoes it. A save lands in the profile patch
and takes effect on the next request — no restart.

Four consequences of the host contract are worth knowing if you touch this code:

- **The host half must export names only — never `export default`.** The loader
  picks a plugin module off with `unwrapExports`
  (`cordis-plugin-loader/lib/index.js`), which prefers `default` over the
  namespace:

  ```js
  exports = exports.default ?? exports      // default REPLACES the namespace
  if (!exports.__esModule) return exports
  return exports.default ?? exports
  ```

  so `export default apply` hands the registry a bare function: `fiber.runtime`
  *is* that function, therefore `fiber.runtime.Config` is `undefined`.
  `dsh-settings` reads the schema from exactly there
  (`schema(entry) { const schema = entry.fiber?.runtime?.Config; … }`) and bails
  out with `return []` when it is missing — so **no settings namespace is ever
  published**. The symptom is maximally misleading: the plugin loads, its client
  half still registers the nav row, every log line is clean, and only the page
  body says *"this host does not serve this configuration"* — which reads like a
  client bug. Every shipped host half exports named only
  (`dsh-client-ui-settings` → `export { Config, apply }`; `dsh-ops` likewise);
  so does this one. `build.mjs` asserts the absence of a default export after
  every build.
- The plugin needed **no** `plugins.item` entry. That slot is occupied by the
  official settings pages; a bundle's configuration belongs in
  `plugins.bundle.config` or `plugins.row.config`, keyed by the bundle's package
  name (here `<package>#<row id>` = `dsh-custom-header#dsh-custom-header`).
- A `settings.section` registration carries the nav identity in its options:
  `id` (required — a fresh id is added beside the shipped rows, reusing theirs
  replaces that row), `order` (ascending position; the shipped rows sit at
  −10/0/10/15/20 and `dsh-market` at 40, so this one takes 50) and `label` (a
  thunk, re-read on every projection so it follows the locale). The Settings
  content column draws **no** heading for a section, so the page renders its own.
- A `.volatile()` field is what makes the entry appear in the settings plane at
  all. Removing the marker removes the page, silently.

```js
ctx.dshCustomHeader.setProfile('codex_desktop')   // programmatic runtime switch
ctx.dshCustomHeader.status()                      // diagnostics snapshot
```

## Known residuals & limits

- **`accept-language` / `sec-fetch-mode`** — injected by Node undici below
  `fetch`, outside the interceptor. Most servers only check UA + custom headers;
  terminate the rest at a local reverse proxy if needed.
- **`?beta=true` for Anthropic** — solved via `urlRewrites.appendQuery`, no
  proxy needed.
- **Cloudflare blocks** — HTML edge responses cannot be fixed by header
  modification; switch API entry, ask for an allowlist, or forward locally.
  The `llm/stream` observer logs a 403 hint distinguishing CF HTML from JSON
  client-restriction rejections.
- **opencode Zen free tier** — header spoofing alone no longer passes. With
  `profile: opencode_zen`, `opencodeZenFree: true` and a free model
  (`*-free` / `big-pickle` / `grok-code`), the body-patch middleware rewrites
  `/zen` → `/inference` and offers the `bash`/`read` tool stubs Zen now
  requires. The model id is read from the request body, which is why the URL
  rewrite lives in that middleware rather than in `url-rewrite.ts`.
- **Request body patches require a re-readable body** — the body-patch
  middleware buffers JSON request bodies (`content-length` is re-computed);
  non-JSON or streamed request bodies are passed through untouched.

## Development

```bash
npm install
npm run typecheck            # tsc against stubs/, not node_modules — see below
npm run build                # esbuild → lib/index.js + lib/client.js; tsc → lib/types (declarations)
npm run check                # typecheck + build
node tests/smoke.mjs         # local capture server; 9 scenarios, 31 checks
```

`tests/smoke.mjs` can also test a bundle without touching `lib/` (useful while a
live desktop app watches the mounted plugin):

```bash
npx esbuild src/index.ts --bundle --format=esm --platform=node --target=node22 \
  --external:@deepseek-ai/cordis --external:@deepseek-ai/dsh-* \
  --outfile=%TEMP%/dch-smoke/index.js
set SMOKE_LIB=%TEMP%/dch-smoke/index.js && node tests/smoke.mjs
```

`@deepseek-ai/*` comes from two *other* places, so the copies in
`node_modules/` are never the ones that matter:

- **types** — `tsconfig.json` maps `@deepseek-ai/*` to `stubs/@deepseek-ai/*`.
  Those stubs are deliberately permissive (`declare const z: { [key: string]: any }`),
  so `npm run typecheck` validates *this* repo's code, not the host API surface.
  A stale local install therefore cannot break the build — and equally, a green
  typecheck does not prove the host's runtime supports what you called.
- **runtime** — `build.mjs` keeps `@deepseek-ai/dsh-*` and `@deepseek-ai/cordis`
  external, so the plugin reaches the **host's** copies, not this repo's. That is
  demonstrable rather than assumed: `@deepseek-ai/schemastery@3.18.1` has no
  `volatile` member at all (`typeof z.string().volatile === 'undefined'`), yet
  every field in `config.ts` calls `.volatile()` and the plugin loads cleanly.
  The host carries:

  | specifier | where the host keeps it |
  | --- | --- |
  | `@deepseek-ai/cordis` | `app.asar` → **4.0.5-alpha.1** |
  | `@deepseek-ai/dsh-llm` | `app.asar` → **0.2.1-alpha.2** |
  | `@deepseek-ai/schemastery` | `app.asar` → **3.18.5-alpha.1**, and also `profiles/<name>/node_modules` → **3.18.4** |

  Both schemastery copies have `.volatile()`; this repo's does not. So the API
  surface you may rely on is the host's, and it drifts with the host — probe it
  rather than trusting the local install. Anyone importing `lib/index.js`
  directly (an offline self-check, say) hits the reverse problem: bare
  `@deepseek-ai/*` resolves to *this* repo's stale copies and blows up for
  reasons that have nothing to do with the code. Redirect those specifiers to the
  host's copies first.

## License

MIT. Client-identity presets mirror publicly documented upstream formats; no
third-party source is vendored. The fetch pipeline is vendored from
`@aizigao/pi-fetch-pipeline` (MIT), re-keyed for DSH.
