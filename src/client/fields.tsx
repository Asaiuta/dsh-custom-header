/**
 * The configuration page's field layer: text ⇄ value conversions, the field
 * table, and the control that renders one row.
 *
 * `SettingsFormModel` owns staging, saving and conflict handling but is
 * deliberately agnostic about *how* a field is drawn — it only asks a spec to
 * `format` a value into text and `parse` text back. That is the seam this file
 * uses: list, dict and boolean fields get their own conversion instead of being
 * forced through the single-line text/number specs the shared primitives ship,
 * and a `parse` that returns `undefined` blocks the save rather than dropping
 * the edit.
 *
 * ## Which control, and why not all of them are ours
 *
 * The product ships a complete vocabulary in
 * `@deepseek-ai/dsh-client-ui-primitives`, and the first version of this page
 * ignored most of it: a nine-value enum, a two-value enum and a boolean were all
 * drawn as free-text inputs, so the page asked people to type `codex_tui` and
 * `true` from memory. The vocabulary is now used where it exists:
 *
 * | field shape | control | owner |
 * | --- | --- | --- |
 * | one-line text | `SettingsValueField` | host |
 * | 2–4 fixed values | `SegmentedControl` | host |
 * | boolean | `Switch` | host |
 * | string list / JSON object | `textarea` | this file |
 *
 * `SettingsValueField` draws the whole row — label, overridden badge, reset,
 * invalid copy, and the collapsible `help` region behind a "?" button — so
 * that kind is passed straight through and inherits the host's markup and
 * ARIA. The remaining three are bare controls with no label slot, so they are
 * wrapped in this page's own `dch-field` head; styles.ts keeps that head
 * looking like the host's rows.
 *
 * A string list has no host control: `SettingsValueField` hardcodes
 * `type="text"`, and there is no textarea primitive. Those fields keep the
 * one-entry-per-line textarea, which is why `hint` on each of them still has to
 * say so.
 */

import type { ChangeEvent } from 'react'
import { SegmentedControl, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CodexFallbackId } from '../types.ts'
import type { CustomHeaderKey } from './locales.ts'
import { CODEX_VARIANT_LABELS } from './scenarios.ts'

/** One field's live view, as `SettingsFormModel.field()` publishes it. */
export interface FieldView {
	text: string
	overridden: boolean
	invalid: boolean
}

/** A field's text ⇄ value conversion. */
export interface FieldSpec {
	field: string
	format(value: unknown): string
	parse(text: string): { kind: 'set'; value: unknown } | { kind: 'clear' } | undefined
}

/** One choice of a segmented field. */
export interface FieldOption {
	value: string
	label: CustomHeaderKey
}

/**
 * How a field is drawn.
 *
 * The first three are named for the host control they select; `textarea` is
 * the one kind this page still draws itself. `hidden` is a field the page
 * never draws a row for: it still needs a spec, because `SettingsFormModel`
 * can only stage an edit to a field it was constructed with, and `profile` is
 * written by the scenario picker rather than by a control of its own.
 */
export type FieldKind = 'value' | 'segmented' | 'switch' | 'textarea' | 'hidden'

/** A row in the form. */
export interface FieldDef {
	field: string
	label: CustomHeaderKey
	hint: CustomHeaderKey
	kind: FieldKind
	/** Textarea height, in rows. Ignored by every other kind. */
	rows?: number
	/** The choices of a `segmented` field, in display order. */
	options?: readonly FieldOption[]
	/**
	 * The long explanation, shown behind the row's "?" button by the two host
	 * kinds. This is where the value vocabulary and the worked examples live, so
	 * the always-visible `hint` can stay one line.
	 */
	help?: { label: CustomHeaderKey; content: CustomHeaderKey }
	spec: (field: string) => FieldSpec
}

const set = (value: unknown) => ({ kind: 'set' as const, value })
const clear = () => ({ kind: 'clear' as const })

/** A single-line string. An empty draft clears the field. */
export function textField(field: string): FieldSpec {
	return {
		field,
		format: (value) => (typeof value === 'string' ? value : ''),
		parse: (text) => (text.trim() === '' ? clear() : set(text.trim())),
	}
}

/** A string list, one entry per line. An empty draft clears the field. */
export function linesField(field: string): FieldSpec {
	return {
		field,
		format: (value) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').join('\n') : ''),
		parse: (text) => {
			const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
			return lines.length === 0 ? clear() : set(lines)
		},
	}
}

/**
 * A plain-object dict as JSON. An empty draft clears the field; anything that
 * is not a JSON object blocks the save, so a half-typed rewrite rule cannot be
 * written as a partial value.
 */
export function jsonField(field: string): FieldSpec {
	return {
		field,
		format: (value) => {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
			const record = value as Record<string, unknown>
			return Object.keys(record).length === 0 ? '' : JSON.stringify(record, null, 2)
		},
		parse: (text) => {
			const trimmed = text.trim()
			if (trimmed === '') return clear()
			try {
				const parsed: unknown = JSON.parse(trimmed)
				if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
				return set(parsed)
			} catch {
				return undefined
			}
		},
	}
}

/**
 * A boolean, staged as the text `"true"` / `"false"`.
 *
 * Text rather than a boolean because `SettingsFormModel` stages strings; the
 * `Switch` this feeds converts both ways at the edge. Spelling it out rather
 * than comparing against `"1"` keeps the staged draft readable in a diff.
 */
export function boolField(field: string): FieldSpec {
	return {
		field,
		format: (value) => (value === true ? 'true' : 'false'),
		parse: (text) => {
			const value = text.trim().toLowerCase()
			if (value === '') return clear()
			if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return set(true)
			if (value === 'false' || value === '0' || value === 'no' || value === 'off') return set(false)
			return undefined
		},
	}
}

/**
 * One of a fixed vocabulary.
 *
 * The value arrives as text, so the controls that already hold a known value —
 * the `SegmentedControl` on `profile`, `codexFallback` and
 * `claudeSystemBlock` — hand back an id that has to be checked here rather than
 * trusted: the spec is the single place a bad value is rejected, whichever
 * control produced it.
 */
export function enumField(field: string, allowed: readonly string[]): FieldSpec {
	return {
		field,
		format: (value) => (typeof value === 'string' ? value : ''),
		parse: (text) => {
			const value = text.trim()
			if (value === '') return clear()
			return allowed.includes(value) ? set(value) : undefined
		},
	}
}

/**
 * The four Codex profiles, as the options of the `codexFallback` row —
 * "which identity should `auto` fall back to for non-Anthropic paths".
 *
 * Derived from the one name table in `scenarios.ts`; the Codex scenario stages
 * `profile` from that same table to mean "which profile am I".
 */
const CODEX_VARIANTS: readonly FieldOption[] = (Object.keys(CODEX_VARIANT_LABELS) as CodexFallbackId[])
	.map((value) => ({ value, label: CODEX_VARIANT_LABELS[value] }))

/**
 * The full profile vocabulary, for `profile`'s spec only — no control is ever
 * built from it. `scenarios.ts` is what maps a tab onto one of these.
 */
const PROFILE_IDS = [
	'auto',
	'off',
	'codex_official',
	'codex_tui',
	'codex_desktop',
	'codex_claude_plugin',
	'pi_agent',
	'claude_code_messages',
	'opencode_zen',
] as const

const CLAUDE_SYSTEM_MODES: readonly FieldOption[] = [
	{ value: 'identity', label: 'modeIdentity' },
	{ value: 'billing', label: 'modeBilling' },
]

/**
 * Every field the page edits, in schema order. The scenario view picks from this
 * table by name and the full view renders all of it, so both stay in step with
 * one definition.
 */
export const FIELDS: readonly FieldDef[] = [
	// Written by the scenario picker, echoed as text under it, never drawn as a
	// row of its own — see the `hidden` kind.
	{ field: 'profile', label: 'profile', hint: 'profileHint', kind: 'hidden', spec: (field) => enumField(field, PROFILE_IDS) },

	{ field: 'codexFallback', label: 'codexFallback', hint: 'codexFallbackHint', kind: 'segmented', options: CODEX_VARIANTS, spec: (field) => enumField(field, CODEX_VARIANTS.map((option) => option.value)) },
	{
		field: 'gatewayHosts',
		label: 'gatewayHosts',
		hint: 'gatewayHostsHint',
		kind: 'textarea',
		rows: 3,
		help: { label: 'helpLabel', content: 'gatewayHostsHelp' },
		spec: linesField,
	},
	{
		field: 'claudeSystemBlock',
		label: 'claudeSystemBlock',
		hint: 'claudeSystemBlockHint',
		kind: 'segmented',
		options: CLAUDE_SYSTEM_MODES,
		spec: (field) => enumField(field, CLAUDE_SYSTEM_MODES.map((option) => option.value)),
	},

	{
		field: 'claudeCliVersion',
		label: 'claudeCliVersion',
		hint: 'versionHint',
		kind: 'value',
		help: { label: 'helpLabel', content: 'versionHelp' },
		spec: textField,
	},
	{
		field: 'codexCliVersion',
		label: 'codexCliVersion',
		hint: 'versionHint',
		kind: 'value',
		help: { label: 'helpLabel', content: 'versionHelp' },
		spec: textField,
	},
	{
		field: 'codexDesktopVersion',
		label: 'codexDesktopVersion',
		hint: 'versionHint',
		kind: 'value',
		help: { label: 'helpLabel', content: 'versionHelp' },
		spec: textField,
	},
	{
		field: 'anthropicBeta',
		label: 'anthropicBeta',
		hint: 'anthropicBetaHint',
		kind: 'value',
		help: { label: 'helpLabel', content: 'versionHelp' },
		spec: textField,
	},
	{
		field: 'opencodeVersion',
		label: 'opencodeVersion',
		hint: 'versionHint',
		kind: 'value',
		help: { label: 'helpLabel', content: 'versionHelp' },
		spec: textField,
	},
	{ field: 'opencodeClient', label: 'opencodeClient', hint: 'opencodeHeaderHint', kind: 'value', spec: textField },
	{ field: 'opencodeProject', label: 'opencodeProject', hint: 'opencodeHeaderHint', kind: 'value', spec: textField },
	{
		field: 'opencodeZenFree',
		label: 'opencodeZenFree',
		hint: 'opencodeZenFreeHint',
		kind: 'switch',
		help: { label: 'helpLabel', content: 'opencodeZenFreeHelp' },
		spec: boolField,
	},

	{
		field: 'extraHeaders',
		label: 'extraHeaders',
		hint: 'jsonHint',
		kind: 'textarea',
		rows: 4,
		help: { label: 'helpLabel', content: 'extraHeadersHelp' },
		spec: jsonField,
	},
	{
		field: 'urlRewrites',
		label: 'urlRewrites',
		hint: 'rewriteHint',
		kind: 'textarea',
		rows: 4,
		help: { label: 'helpLabel', content: 'rewriteHelp' },
		spec: jsonField,
	},
]

/** The conversion specs `SettingsFormModel` stages edits through. */
export const SPECS: readonly FieldSpec[] = FIELDS.map((def) => def.spec(def.field))

/** Look one field up by name. */
export function fieldDef(field: string): FieldDef | undefined {
	return FIELDS.find((def) => def.field === field)
}

/**
 * The label row every hand-drawn kind shares: name, overridden badge, reset.
 *
 * The two host-drawn kinds carry their own copy of this, which is exactly why
 * they are preferred — this exists only for the controls the host ships bare.
 */
function FieldHead(props: {
	def: FieldDef
	view: FieldView | undefined
	disabled: boolean
	t: (key: CustomHeaderKey) => string
	onReset: (field: string) => void
}): JSX.Element {
	const { def, view, disabled, t } = props
	return (
		<div className="dch-fieldHead">
			<label className="dch-label" htmlFor={`dsh-custom-header-${def.field}`}>{t(def.label)}</label>
			{view?.overridden === true ? (
				<span className="dch-badges">
					<span className="dch-badge">{t('overridden')}</span>
					<button
						type="button"
						className="dch-reset"
						disabled={disabled}
						onClick={() => { props.onReset(def.field) }}
					>
						{t('reset')}
					</button>
				</span>
			) : null}
		</div>
	)
}

/**
 * One row. The staged text comes from the form model; this renders it with
 * whichever control the field's shape calls for, reports the edit back as text,
 * and offers the reset that stages a return to the composition layer.
 *
 * Every kind reports through the same `onEdit(field, text)` channel — the
 * segmented control and the switch convert their value to the text `parse`
 * already understands, rather than opening a second path into the form model.
 * That keeps one place (the spec) where a value is validated.
 */
export function Field(props: {
	def: FieldDef
	view: FieldView | undefined
	disabled: boolean
	t: (key: CustomHeaderKey) => string
	onEdit: (field: string, text: string) => void
	onReset: (field: string) => void
}): JSX.Element {
	const { def, view, disabled, t } = props
	const id = `dsh-custom-header-${def.field}`
	const text = view?.text ?? ''
	const invalid = view?.invalid === true
	const overridden = view?.overridden === true
	const onChange = (event: ChangeEvent<{ value: string }>) => {
		props.onEdit(def.field, event.target.value)
	}
	const hint = invalid
		? <p className="dch-invalid">{t('invalid')}</p>
		: <p className="dch-hint">{t(def.hint)}</p>

	if (def.kind === 'value') {
		return (
			<SettingsValueField
				id={id}
				label={t(def.label)}
				hint={t(def.hint)}
				help={def.help === undefined ? undefined : { label: t(def.help.label), content: t(def.help.content) }}
				overriddenLabel={t('overridden')}
				resetLabel={t('reset')}
				invalidLabel={t('invalid')}
				text={text}
				overridden={overridden}
				invalid={invalid}
				disabled={disabled}
				onEdit={(next: string) => { props.onEdit(def.field, next) }}
				onReset={() => { props.onReset(def.field) }}
			/>
		)
	}

	return (
		<div className="dch-field">
			<FieldHead def={def} view={view} disabled={disabled} t={t} onReset={props.onReset} />
			{def.kind === 'segmented' ? (
				<SegmentedControl
					id={id}
					label={t(def.label)}
					value={text}
					options={(def.options ?? []).map((option) => ({ value: option.value, label: t(option.label) }))}
					disabled={disabled}
					onChange={(next: string) => { props.onEdit(def.field, next) }}
				/>
			) : def.kind === 'switch' ? (
				<Switch
					checked={text === 'true'}
					label={t(def.label)}
					disabled={disabled}
					onChange={(next: boolean) => { props.onEdit(def.field, next ? 'true' : 'false') }}
				/>
			) : def.kind === 'textarea' ? (
				<textarea
					id={id}
					className="dch-control dch-area"
					value={text}
					rows={def.rows ?? 3}
					spellCheck={false}
					disabled={disabled}
					aria-invalid={invalid ? true : undefined}
					onChange={onChange}
				/>
			) : null}
			{hint}
		</div>
	)
}
