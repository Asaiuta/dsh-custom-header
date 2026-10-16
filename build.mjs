/**
 * Two builds for dsh-custom-header: the host half and the browser half.
 *
 * The host half is one ESM Cordis plugin. It exports a schemastery `Config`
 * schema — every field `.volatile()`, which is what makes the native settings
 * plane publish a namespace for it — and, in `apply`, registers four
 * host-allowlisted fetch middlewares (URL rewrite, fingerprint strip, header
 * inject, body patch) into the shared `globalThis.fetch` pipeline. Its config
 * is changed live, so the middlewares read a snapshot refreshed on every
 * `loader/volatile-update` instead of snapshotting it at mount.
 *
 * The browser half is the configuration page. It is loaded by the desktop
 * shell's `__ModuleLoader__`, so it is emitted as CJS wrapped in a
 * `load({ id, factory })` call — the same shape the shipped client bundles use.
 * `react`, `react/jsx-runtime` and `@deepseek-ai/dsh-client-ui-primitives` stay
 * external because the shell supplies them from its frozen platform table; a
 * bundle that inlined its own React would render into a different dispatcher
 * than the page it lives in.
 *
 * `@deepseek-ai/dsh-*` and `@deepseek-ai/cordis` stay external on both sides and
 * resolve from the host's node_modules at runtime.
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

// Clean the previous build so removed source files don't leave stale bundles
// or declaration files behind.
rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })

const require = createRequire(import.meta.url)
const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-*']

// ---------------------------------------------------------------------------
// Host half: ESM, Node, external runtime packages.
// ---------------------------------------------------------------------------
await build({
	entryPoints: ['src/index.ts'],
	outfile: 'lib/index.js',
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: ['node22'],
	sourcemap: true,
	external: dshExternal,
	logLevel: 'info',
})

// ---------------------------------------------------------------------------
// Browser half: CJS inside the shell's module loader.
// ---------------------------------------------------------------------------
const CLIENT_ID = 'dsh-custom-header'

const platformExternal = [
	'react',
	'react-dom',
	'react/jsx-runtime',
	'react/jsx-dev-runtime',
	'scheduler',
	...dshExternal,
]

await build({
	entryPoints: ['src/client/index.tsx'],
	outfile: 'lib/client.js',
	bundle: true,
	format: 'cjs',
	platform: 'browser',
	target: ['es2022'],
	jsx: 'automatic',
	sourcemap: true,
	// The comment header the shipped bundles carry; the loader keys modules by
	// `id`, and other bundles reach this one by that same id.
	banner: {
		js: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(CLIENT_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
	},
	footer: { js: '\t\treturn module.exports;\n\t}\n});' },
	external: [...platformExternal, '@deepseek-ai/dsh-client-*', '@deepseek-ai/dsh-api-*'],
	logLevel: 'info',
})

// ---------------------------------------------------------------------------
// Host-half contract gate.
//
// The Loader picks a plugin module off with `unwrapExports`, which prefers
// `default` over the namespace: `exports = exports.default ?? exports`. A
// `default` export therefore REPLACES the plugin object, and `fiber.runtime`
// becomes whatever it holds. `dsh-settings` reads the schema from
// `entry.fiber.runtime.Config`, so a default-exported `apply` leaves every
// settings namespace unpublished while the plugin still loads — the page then
// says "this host does not serve this configuration" with nothing in any log.
// Shipped host halves export named only; assert the same here.
// ---------------------------------------------------------------------------
const hostBundle = readFileSync('lib/index.js', 'utf8')
if (/(?:^|\n)\s*export default\b|\bas default\b/m.test(hostBundle)) {
	throw new Error(
		'lib/index.js exports a default — the Loader would use it instead of the module namespace ' +
			'and `entry.fiber.runtime.Config` would be undefined (settings namespace never published). ' +
			'Export `apply` / `inject` / `name` / `Config` by name only.',
	)
}
if (!/\bConfig\b/.test(hostBundle)) throw new Error('lib/index.js does not export `Config`')

// ---------------------------------------------------------------------------
// Typecheck + emit declarations (PATH-independent, cross-platform).
// ---------------------------------------------------------------------------
execFileSync(process.execPath, [require.resolve('typescript/lib/tsc.js'), '-p', 'tsconfig.json'], { stdio: 'inherit' })
