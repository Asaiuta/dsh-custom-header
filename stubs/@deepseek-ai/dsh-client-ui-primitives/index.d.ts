/**
 * Typecheck stub for `@deepseek-ai/dsh-client-ui-primitives` — the settings-form
 * pieces the configuration page uses, and nothing else.
 *
 * The real package is a platform module in the browser; the page reaches it
 * through `require()` at load time, so only these declarations matter here.
 * Signatures are transcribed from the shipped 0.2.1-alpha.2 bundle.
 *
 * Only the two settings rows and the form frame carry a label/hint/badge/help
 * structure of their own. `SegmentedControl`, `SegmentedTabs` and `Switch` are
 * bare controls — the page wraps those in its own row — which is why their
 * declarations here are shorter.
 */

import type { ReactNode } from 'react'

/** The frame's copy. */
export interface SettingsFormLabels {
	unavailable: string
	readOnly: string
	saveFailed: string
	save: string
	saving: string
}

/** What the frame needs to decide whether a save is offered. */
export interface SettingsFormShell {
	available: boolean
	writable: boolean
	dirty: boolean
	invalid: boolean
	saving: boolean
	failed: boolean
}

/** One control's staged text and whether a save would write or reject it. */
export interface SettingsFieldView {
	text: string
	overridden: boolean
	invalid: boolean
}

/** One field's text ⇄ value conversion. */
export interface SettingsFieldSpec {
	field: string
	format(value: unknown): string
	parse(text: string): { kind: 'set'; value: unknown } | { kind: 'clear' } | undefined
}

/** The staged form frame: renders the controls, then the single save. */
export function SettingsForm(props: {
	labels: SettingsFormLabels
	state: SettingsFormShell
	onSave: () => void
	onDiscard: () => void
	children?: ReactNode
}): JSX.Element

/**
 * A labelled single-line text row, with the overridden badge, the reset action,
 * the invalid copy and the collapsible help region owned by the control.
 *
 * `type` is hardcoded to `text`; only `inputMode` follows `numeric`. There is no
 * multiline form of this row, which is why string lists stay on the page's own
 * textarea.
 */
export function SettingsValueField(props: {
	id: string
	label: ReactNode
	hint?: ReactNode
	help?: { label: string; content: ReactNode }
	text: string
	overridden: boolean
	overriddenLabel: string
	resetLabel: string
	invalid: boolean
	invalidLabel: string
	numeric?: boolean
	placeholder?: string
	disabled: boolean
	onEdit: (text: string) => void
	onReset: () => void
}): JSX.Element

/**
 * A write-only credential row: a `password` input plus a badge reporting
 * whether a value is configured.
 *
 * Upstream semantics are "a blank draft writes nothing", because the value never
 * rides a response and blanking the box must not silently delete a stored key.
 * The configuration page keeps a normal staged row here instead (a blank draft
 * clears the field), so the badge is what tells the user a value is present.
 */
export function SettingsSecretField(props: {
	id: string
	label: ReactNode
	hint: ReactNode
	text: string
	configured: boolean
	stateLabel: string
	disabled: boolean
	onEdit: (text: string) => void
}): JSX.Element

/** One segment of a {@link SegmentedControl}. */
export interface SegmentedOption {
	value: string
	label: ReactNode
	disabled?: boolean
	title?: string
}

/** A controlled segmented control, `role="tablist"`, with a sliding indicator. */
export function SegmentedControl(props: {
	id: string
	label: string
	value: string
	options: readonly SegmentedOption[]
	onChange: (value: string) => void
	disabled?: boolean
	className?: string
}): JSX.Element

/** One tab of a {@link SegmentedTabs} strip. */
export interface SegmentedTabItem {
	value: string
	/** DOM id of the tab button. */
	id: string
	/** DOM id of the panel this tab names through `aria-controls`. */
	panelId: string
	label: ReactNode
}

/**
 * A controlled tab strip: equal-width tabs, a sliding indicator, and arrow /
 * Home / End navigation. Panels remain the caller's.
 *
 * Every tab takes an equal share of the width, so labels have to stay short.
 */
export function SegmentedTabs(props: {
	items: readonly SegmentedTabItem[]
	value: string
	onChange: (value: string) => void
	label: string
	className?: string
}): JSX.Element

/** A controlled boolean switch. `onChange` receives the requested state. */
export function Switch(props: {
	checked: boolean
	onChange: (checked: boolean) => void
	label: string
	disabled?: boolean
	title?: string
	className?: string
}): JSX.Element

/**
 * A controlled disclosure: a header row that toggles, and its content.
 *
 * `open` and `onToggle` are the caller's; `expandOnRowClick` moves the toggle
 * onto the whole row instead of just the chevron.
 */
export function DisclosureRow(props: {
	icon?: ReactNode
	title: ReactNode
	open: boolean
	expandable?: boolean
	onToggle: () => void
	running?: boolean
	expandOnRowClick?: boolean
	previewChevron?: boolean
	keepContentWhenOpen?: boolean
	collapsedContent?: ReactNode
	headerAccessory?: ReactNode
	children?: ReactNode
	className?: string
	rowClassName?: string
	contentClassName?: string
	contentLayoutClassName?: string
	leadingClassName?: string
	chevronClassName?: string
	titleClassName?: string
}): JSX.Element

/** The staged edit model behind a settings page. */
export class SettingsFormModel {
	constructor(scope: unknown, specs: readonly SettingsFieldSpec[], secrets?: readonly unknown[])
	bind<T>(project: () => T): unknown
	shell(): SettingsFormShell
	field(field: string): SettingsFieldView
	actions(): {
		edit(field: string, text: string): void
		resetField(field: string): void
		save(): void
		discard(): void
	}
	dispose(): void
}
