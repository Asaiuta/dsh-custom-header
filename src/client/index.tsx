/**
 * dsh-custom-header — browser half: the plugin's configuration page.
 *
 * The page is a **Settings section**: it appears in the Settings panel's own
 * navigation as a row of its own, beside General / Models / Plugins, through the
 * `settings.section` slot. That slot is a `list` at root scope whose registration
 * carries the nav identity — `id` (required; a fresh id is added beside the
 * shipped rows, while reusing one replaces that row), `order` (ascending nav
 * position) and `label` (a thunk, so the row follows the active locale without
 * re-registering). Its owner props are just `{ close }`; the section renders
 * inside the panel's content column, which draws no heading of its own, so the
 * page supplies its own title and description.
 *
 * The page also keeps its seat on the Plugins page (`plugins.row.config`, keyed
 * `<bundle package name>#<row id>`), which is where the host's own slot contract
 * puts a *bundle's* configuration. Both seats are deliberate: the section is
 * where a user reaches these settings from Settings, the row page is where the
 * plugin manager shows them for the installed bundle.
 *
 * ## Shape of the page
 *
 * The first version of this page opened on every control at once. Accurate
 * labels are a good description of the *config* and a poor description
 * of the *job* — nobody arrives wanting to set `gatewayHosts`; they arrive wanting
 * Codex, or Claude Code, or opencode, to reach their own gateway. The page is
 * now a small shell with a nav rail and three stable pages (the layout follows
 * `dsh-any-background`'s settings section):
 *
 * 1. **A nav rail** on the left: one item per page, with the plugin's own brand
 *    block above it. Pages are fixed slices of the config — identity &
 *    gateway, version headers, advanced — and **every field has exactly one
 *    home**. Switching pages never reclassifies a row, which is the point: a
 *    field that relocated while being edited (the previous layout moved a
 *    row out of its disclosure the moment an edit made it "overridden") read
 *    as the UI glitching.
 * 2. **The identity page's scenario picker.** One tab per intent. Picking one
 *    stages a `profile` value, which is what makes the scenario real rather
 *    than cosmetic — the tab, the hint under it and the staged-profile echo all
 *    read the same value.
 * 3. **The page's fields**, drawn with the host control each field's shape
 *    calls for (`fields.tsx`). Only the active page's fields are rendered, so
 *    one field is mounted exactly once and each control's DOM id stays unique.
 *
 * ## Why the fields must be volatile, and why that is enough
 *
 * The page edits the entry's real `Config` through `ctx.configForms`, the one
 * accepted-value mirror the client shares. Two facts from the host decide
 * whether that works at all:
 *
 *  1. `dsh-settings` publishes a namespace only for entries whose schema has a
 *     volatile field, and its writer rejects any other path. Every field of the
 *     plugin's `Config` is therefore marked `.volatile()` (`src/config.ts`).
 *  2. A volatile-only change is committed into the running host fiber instead
 *     of remounting it, which is what keeps a save from restarting the plugin
 *     mid-session — and why the host half re-reads its per-request snapshot
 *     on `loader/volatile-update`.
 *
 * The section row is registered **without** waiting on `configForms.whileServed`
 * — unlike the four official pages, whose namespaces belong to other plugins and
 * may genuinely be absent. This namespace is this bundle's own row, so the row
 * always exists; registering unconditionally means a host that fails to serve it
 * shows the page in its `unavailable` state instead of hiding the entry, which
 * is the difference between a diagnosable failure and a silent one.
 *
 * Writes are staged: typing edits a draft, and only **Save** mutates the
 * settings document. Picking a scenario is one more staged edit and follows the
 * same rule — it lands on Save and is undone by Discard, never mid-flight. The
 * write is revision-fenced by the shared form, so a concurrent change elsewhere
 * fails the save instead of silently overwriting it.
 */

import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { SegmentedControl, SegmentedTabs, SettingsForm, SettingsFormModel } from '@deepseek-ai/dsh-client-ui-primitives'
import { FIELDS, Field, SPECS, fieldDef, type FieldView } from './fields.tsx'
import { NS, en, zh, type CustomHeaderKey } from './locales.ts'
import { CODEX_VARIANT_LABELS, SCENARIOS, matchScenario, scenarioOf, type ScenarioId } from './scenarios.ts'
import { NAV_GAP, NAV_ITEM_H, mountStyles } from './styles.ts'

/** Required services: slot registry, locale dictionaries, the shared config forms. */
export const inject = ['slots', 'locale', 'configForms']

/** The Loader row this plugin's configuration lives in (also its settings namespace). */
const ROW_ID = 'dsh-custom-header'

/** `plugins.row.config` key: `<bundle package name>#<row id>`. */
const ROW_KEY = `${ROW_ID}#${ROW_ID}`

/**
 * `settings.section` id. The slot is a list, so a fresh id is added beside the
 * shipped rows; reusing one of theirs would replace that row instead.
 */
const SECTION_ID = 'dsh-custom-header'

/**
 * Nav position in the Settings panel (ascending). The shipped rows sit at
 * -10 (account), 0 (general), 10 (models), 15 (plugins) and 20 (agent
 * presets); dsh-market takes 40, so 50 puts this row after all of them.
 */
const SECTION_ORDER = 50

/** The rail's page ids, in display order. */
type PageId = 'identity' | 'versions' | 'advanced'

/** One page: its labels, and the fields whose permanent home it is. */
interface PageDef {
	id: PageId
	/** Rail item and page heading. */
	label: CustomHeaderKey
	/** Small uppercase category line above the heading. */
	overline: CustomHeaderKey
	/** One-paragraph description under the heading. */
	desc: CustomHeaderKey
	/** The fields this page renders, in schema order. */
	fields: readonly string[]
}

/**
 * The three pages, in rail order. Together their field lists cover every
 * visible field of `FIELDS` exactly once — a field missing here would be
 * unreachable, and one listed twice would mount twice.
 */
const PAGES: readonly PageDef[] = [
	{
		id: 'identity',
		label: 'navIdentity',
		overline: 'overlineIdentity',
		desc: 'descIdentity',
		fields: ['gatewayHosts', 'codexFallback', 'claudeSystemBlock'],
	},
	{
		id: 'versions',
		label: 'navVersions',
		overline: 'overlineVersions',
		desc: 'descVersions',
		fields: [
			'claudeCliVersion',
			'codexCliVersion',
			'codexDesktopVersion',
			'anthropicBeta',
			'opencodeVersion',
			'opencodeClient',
			'opencodeProject',
			'opencodeZenFree',
		],
	},
	{
		id: 'advanced',
		label: 'navAdvanced',
		overline: 'overlineAdvanced',
		desc: 'descAdvanced',
		fields: ['extraHeaders', 'urlRewrites'],
	},
]

/** The identity page's fields card, named by the scenario tabs through `aria-controls`. */
const SCENARIO_PANEL_ID = `${ROW_ID}-identity-fields`

type Translate = (key: CustomHeaderKey) => string

/** The form state the page renders: the shared shell plus one view per field. */
interface PageState {
	available: boolean
	writable: boolean
	dirty: boolean
	invalid: boolean
	saving: boolean
	failed: boolean
	fields: Record<string, FieldView>
}

/** The face a slot entry injects: the snapshot store and the staged-edit actions. */
interface PageFace {
	hooks: { customHeaderConfig: unknown }
	save: () => void
	discard: () => void
	edit: (field: string, text: string) => void
	resetField: (field: string) => void
}

/**
 * Stage one plugin row's configuration over the shared settings form.
 *
 * `SettingsFormModel` does the work — baseline revision, dirty/invalid/saving
 * state, and the single `mutate` on save — while the projection adds the
 * per-field views the controls render.
 *
 * Every field in `FIELDS` is registered, including `profile`, which has no row
 * of its own: the model can only stage an edit to a field it was built with, and
 * the scenario picker stages `profile`.
 */
class PageController {
	private readonly form: SettingsFormModel
	private readonly store: unknown

	constructor(scope: unknown) {
		this.form = new SettingsFormModel(scope, [...SPECS])
		this.store = this.form.bind((): PageState => ({
			...this.form.shell(),
			fields: Object.fromEntries(FIELDS.map((def) => [def.field, this.form.field(def.field)])),
		}))
	}

	/** Build the face the slot registration injects. */
	inject(): PageFace {
		return {
			hooks: { customHeaderConfig: this.store },
			...this.form.actions(),
		}
	}

	/** Release the form's accepted-value subscription. */
	dispose(): void {
		this.form.dispose()
	}
}

/** The form's own copy, kept beside the page's. */
function formLabels(t: Translate) {
	return {
		unavailable: t('unavailable'),
		readOnly: t('readOnly'),
		saveFailed: t('saveFailed'),
		save: t('save'),
		saving: t('saving'),
	}
}

/** The rail's brand glyph: three sliders — the page's own subject, drawn small. */
function TuneIcon(): JSX.Element {
	return (
		<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
			<circle cx="6" cy="4" r="1.8" fill="currentColor" />
			<circle cx="10.5" cy="8" r="1.8" fill="currentColor" />
			<circle cx="4.5" cy="12" r="1.8" fill="currentColor" />
		</svg>
	)
}

/**
 * Render the configuration form, or the row's one-liner when the Plugins page
 * asks for it.
 *
 * The same component serves both seats: the Settings section renders it with no
 * `view` (the shell supplies only `close`), and `plugins.row.config` asks for
 * `view: 'summary'` for the row's one-liner and `view: 'page'` for the page.
 *
 * The heading is the page's own because the Settings content column draws no
 * heading for a section — the registration's `label` only feeds the nav row.
 */
function CustomHeaderConfigPage(props: {
	view?: string
	t: Translate
	useCustomHeaderConfig: (selector: (snapshot: PageState) => unknown) => unknown
	save: () => void
	discard: () => void
	edit: (field: string, text: string) => void
	resetField: (field: string) => void
}): JSX.Element {
	const { t } = props
	// Hooks cannot sit behind the early return below, so the page selection is
	// declared before it. The summary view simply ignores it.
	const [page, setPage] = useState<PageId>('identity')
	if (props.view === 'summary') return <>{t('summary')}</>

	const state = props.useCustomHeaderConfig((snapshot) => snapshot) as PageState
	const disabled = state.writable !== true
	const views = state.fields ?? {}

	// The picker's selection is derived, not stored: the staged `profile` *is*
	// the selection. Clicking a tab stages a profile, and `matchScenario` reads
	// that same value back, so a tab can never disagree with the value beneath it.
	const profile = views.profile?.text ?? 'auto'
	const active = scenarioOf(matchScenario(profile))

	const pageIndex = Math.max(0, PAGES.findIndex((def) => def.id === page))
	const pageDef = PAGES[pageIndex]

	/** Render one field by name, skipping the ones the page never draws a row for. */
	const render = (field: string) => {
		const def = fieldDef(field)
		if (def === undefined || def.kind === 'hidden') return null
		return (
			<Field
				key={def.field}
				def={def}
				t={t}
				view={views[def.field]}
				disabled={disabled}
				onEdit={props.edit}
				onReset={props.resetField}
			/>
		)
	}

	return (
		<div className="dch-root">
			<SettingsForm
				labels={formLabels(t)}
				state={state}
				onSave={props.save}
				onDiscard={props.discard}
			>
				<div className="dch-shell">
					<nav className="dch-nav">
						<div className="dch-brand">
							<div className="dch-brandTile"><TuneIcon /></div>
							<div className="dch-brandMeta">
								<div className="dch-brandName">{t('title')}</div>
								<div className="dch-brandTag">{t('brandTag')}</div>
							</div>
						</div>
						<div className="dch-navList">
							<div
								className="dch-navInd"
								style={{ transform: `translateY(${pageIndex * (NAV_ITEM_H + NAV_GAP)}px)` }}
							/>
							{PAGES.map((def) => (
								<button
									key={def.id}
									type="button"
									className={def.id === pageDef.id ? 'dch-navItem is-active' : 'dch-navItem'}
									onClick={() => { setPage(def.id) }}
								>
									<span className="dch-navLabel">{t(def.label)}</span>
								</button>
							))}
						</div>
					</nav>

					<div className="dch-page" key={pageDef.id}>
						<header className="dch-head">
							<div className="dch-overline">{t(pageDef.overline)}</div>
							<h2 className="dch-h1">{t(pageDef.label)}</h2>
							<p className="dch-desc">{t(pageDef.desc)}</p>
						</header>

						{pageDef.id === 'identity' ? (
							<section className="dch-card">
								<SegmentedTabs
									label={t('scenarioLabel')}
									value={active.id}
									items={SCENARIOS.map((scenario) => ({
										value: scenario.id,
										id: `${ROW_ID}-scenario-${scenario.id}`,
										panelId: SCENARIO_PANEL_ID,
										label: t(scenario.label),
									}))}
									onChange={(next: string) => { props.edit('profile', scenarioOf(next as ScenarioId).profile) }}
								/>
								<p className="dch-scenarioHint">{t(active.hint)}</p>
								{active.variants === undefined ? null : (
									<div className="dch-field dch-variant">
										<div className="dch-fieldHead">
											<span className="dch-label">{t('variantLabel')}</span>
										</div>
										<SegmentedControl
											id={`${ROW_ID}-profile`}
											label={t('profile')}
											value={profile}
											options={active.variants.map((variant) => ({ value: variant, label: t(CODEX_VARIANT_LABELS[variant]) }))}
											disabled={disabled}
											onChange={(next: string) => { props.edit('profile', next) }}
										/>
									</div>
								)}
								<p className="dch-profileEcho">
									{t('profileEcho')} <code className="dch-code">{profile}</code>
								</p>
							</section>
						) : null}

						<section className="dch-card" id={pageDef.id === 'identity' ? SCENARIO_PANEL_ID : undefined}>
							{pageDef.fields.map(render)}
						</section>
					</div>
				</div>
			</SettingsForm>
		</div>
	)
}

/**
 * Mount the configuration page in both of its seats.
 *
 * 1. **`settings.section`** — the page appears in the Settings panel's own
 *    navigation. Registered outright rather than through
 *    `configForms.whileServed`: the namespace is this bundle's own row and
 *    always exists, and registering unconditionally keeps a host that fails to
 *    serve it from hiding the entry (the page renders its `unavailable` copy
 *    instead). `slots.inject` still wraps it, because the slot only exists while
 *    `ui-settings-general` — the occupant of `sidebar.settings` that declares it
 *    — is mounted.
 *
 * 2. **`plugins.row.config`** — the canonical seat for a *bundle's* own
 *    configuration on the Plugins page, keyed `<package name>#<row id>`. That
 *    page only exists while `client-ui-plugin-manager` is mounted, which is why
 *    this registration additionally follows the served namespace.
 *
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
	const t = ctx.locale.bind(NS) as Translate
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-custom-header: dictionaries')

	ctx.effect(() => mountStyles(), 'dsh-custom-header: page styles')

	const page = new PageController(ctx.configForms.get(ROW_ID))
	ctx.effect(() => () => {
		page.dispose()
	}, 'dsh-custom-header: form subscription')

	ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
		name: 'settings.section',
		id: SECTION_ID,
		order: SECTION_ORDER,
		label: () => t('title'),
		locale: NS,
		inject: () => page.inject(),
	}, CustomHeaderConfigPage)), 'dsh-custom-header: settings section')

	ctx.effect(() => ctx.configForms.whileServed([ROW_ID], () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
		name: 'plugins.row.config',
		key: ROW_KEY,
		locale: NS,
		inject: () => page.inject(),
	}, CustomHeaderConfigPage))), 'dsh-custom-header: row configuration page')
}
