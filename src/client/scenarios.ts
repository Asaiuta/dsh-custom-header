/**
 * The configuration page's scenario layer.
 *
 * The page used to open on every control at once, each labelled with its own
 * schema path. That is an accurate description of the config and a poor
 * description of the *job*: almost nobody arrives wanting to set `gatewayHosts` —
 * they arrive wanting Codex (or Claude Code, or opencode) to reach their own
 * gateway. A scenario is that intent, named: picking one stages the `profile`
 * value that makes the intent real.
 *
 * One rule keeps the page honest: **a scenario stages `profile`; it never
 * writes it.** Selecting a tab is one more staged edit, so it lands only on
 * **Save** and is undone by **Discard** like any other field. Nothing here
 * touches the settings document.
 *
 * A scenario deliberately does **not** own a list of fields. The page's fields
 * live on fixed pages (identity / versions / advanced) and never move when the
 * scenario changes — a row that relocates while the user is editing it is the
 * exact weirdness this layout was built to remove.
 *
 * The nine profile ids in `types.ts` fold onto six scenarios with no
 * remainder, so there is no "unknown" state to represent and no seventh tab.
 */

import type { CodexFallbackId, GatewayClientProfileId } from '../types.ts'
import { isCodexFallbackId } from '../types.ts'
import type { CustomHeaderKey } from './locales.ts'

/** A named intent, one tab in the picker. */
export type ScenarioId = 'auto' | 'codex' | 'claudeCode' | 'pi' | 'opencode' | 'off'

/** One scenario: its labels and the profile it stages. */
export interface Scenario {
	id: ScenarioId
	/** Tab label. */
	label: CustomHeaderKey
	/** One line under the picker, describing what this scenario does. */
	hint: CustomHeaderKey
	/** The profile value this scenario stages. */
	profile: GatewayClientProfileId
	/**
	 * Profiles this scenario can stage instead of {@link profile}, offered as a
	 * second-level choice. Only the Codex scenario has variants — the four
	 * profiles differ in the client signature they impersonate.
	 */
	variants?: readonly CodexFallbackId[]
}

/**
 * The scenario list, in tab order. `off` is last: it is the one tab that means
 * "stop", and it belongs at the end of the strip rather than beside the intents
 * a user picks between.
 */
export const SCENARIOS: readonly Scenario[] = [
	{
		id: 'auto',
		label: 'scenarioAuto',
		hint: 'scenarioAutoHint',
		profile: 'auto',
	},
	{
		id: 'codex',
		label: 'scenarioCodex',
		hint: 'scenarioCodexHint',
		profile: 'codex_official',
		variants: ['codex_official', 'codex_tui', 'codex_desktop', 'codex_claude_plugin'],
	},
	{
		id: 'claudeCode',
		label: 'scenarioClaudeCode',
		hint: 'scenarioClaudeCodeHint',
		profile: 'claude_code_messages',
	},
	{
		id: 'pi',
		label: 'scenarioPi',
		hint: 'scenarioPiHint',
		profile: 'pi_agent',
	},
	{
		id: 'opencode',
		label: 'scenarioOpencode',
		hint: 'scenarioOpencodeHint',
		profile: 'opencode_zen',
	},
	{
		id: 'off',
		label: 'scenarioOff',
		hint: 'scenarioOffHint',
		profile: 'off',
	},
]

const BY_ID = new Map<ScenarioId, Scenario>(SCENARIOS.map((scenario) => [scenario.id, scenario]))

/**
 * The four Codex profiles' display names.
 *
 * One table with two render sites: the Codex scenario's variant picker writes
 * `profile` from it, and the `codexFallback` row names the same four profiles
 * to say which one `auto` should use for non-Anthropic paths. It is one
 * vocabulary, so it lives in one place — the two sites differ in which field
 * they edit, not in what the values are called.
 */
export const CODEX_VARIANT_LABELS: Record<CodexFallbackId, CustomHeaderKey> = {
	codex_official: 'profileCodexOfficial',
	codex_tui: 'profileCodexTui',
	codex_desktop: 'profileCodexDesktop',
	codex_claude_plugin: 'profileCodexClaudePlugin',
}

/** The scenario with this id. Every {@link ScenarioId} is present. */
export function scenarioOf(id: ScenarioId): Scenario {
	const scenario = BY_ID.get(id)
	if (scenario === undefined) throw new Error(`unknown scenario ${id}`)
	return scenario
}

/**
 * The scenario a profile value belongs to.
 *
 * Total by construction: `normalizeCustomHeaderConfig()` only ever lets the nine
 * `GatewayClientProfileId` values through, and those nine cover the six
 * scenarios. The final fallback exists so a hand-edited `cordis.yml` that
 * somehow carried another string still renders a page — it lands on `auto`,
 * which is the profile the sanitiser would have substituted anyway.
 *
 * @param profile - the staged `profile` value.
 * @returns the scenario to open on.
 */
export function matchScenario(profile: string): ScenarioId {
	if (profile === 'auto') return 'auto'
	if (profile === 'off') return 'off'
	if (isCodexFallbackId(profile)) return 'codex'
	if (profile === 'claude_code_messages') return 'claudeCode'
	if (profile === 'pi_agent') return 'pi'
	if (profile === 'opencode_zen') return 'opencode'
	return 'auto'
}

