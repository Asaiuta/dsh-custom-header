/**
 * The configuration page's stylesheet, injected once into the document head.
 *
 * The page borrows the product's own design vocabulary — the same custom
 * properties `@deepseek-ai/dsh-client-ui-primitives`' `settings-form` sheets
 * use — so it sits in the Plugins page without looking foreign. It ships as a
 * stylesheet rather than inline style objects because the states that carry
 * most of the meaning are the ones inline styles cannot express: `:hover`,
 * `:focus-visible`, `:disabled` and `[aria-invalid]`.
 *
 * Every class is prefixed `dch-` and every rule is scoped under `.dch-root`, so
 * nothing here can reach another plugin's markup.
 *
 * ## The shell
 *
 * The page is laid out as a nav rail + content column (`.dch-shell`), the same
 * arrangement `dsh-any-background`'s settings section uses: a sticky rail with
 * the brand block and one item per page on the left, an animated content column
 * on the right. Below 620px of container width the rail folds into a
 * horizontal strip, and the sliding indicator gives way to a plain active
 * background — the indicator's `translateY` no longer matches a row of items.
 *
 * ## What this sheet deliberately does not style
 *
 * Most rows are the host's own (`SettingsValueField`, `SegmentedControl`,
 * `Switch`, `SegmentedTabs`), which carry their own CSS-module styles. This
 * sheet only dresses the rows the page still draws (`dch-field`), the cards and
 * rail around them.
 *
 * In particular there is **no divider between rows**: a rule like
 * `.dch-field + .dch-field { border-top }` would fire between two of the page's
 * rows and be absent after a host row, drawing half a separator. Rows are
 * separated by spacing instead, which the host rows honour on their own.
 *
 * Two tokens used below are supplied by the active theme at runtime rather than
 * defined in the host's base sheets — `--dsw-font-mono` and
 * `--dsw-alias-bg-layer-4` — so they carry a fallback instead of resolving to
 * nothing.
 */

/** The injected element's id, so a reload reuses one stylesheet instead of stacking them. */
export const STYLE_ID = 'dsh-custom-header-styles'

/** Rail item height, in px. Shared with the page's sliding-indicator math. */
export const NAV_ITEM_H = 38

/** Gap between rail items, in px. Shared with the page's sliding-indicator math. */
export const NAV_GAP = 4

export const STYLE_CSS = `
.dch-root {
	display: flex;
	flex-direction: column;
	width: 100%;
	min-width: 0;
	container-type: inline-size;
	color: var(--dsw-alias-label-primary);
}

.dch-root,
.dch-root *,
.dch-root *::before,
.dch-root *::after {
	box-sizing: border-box;
}

.dch-root button {
	font-family: inherit;
}

/* ── shell: nav rail + content column ────────────────────────────────────── */
.dch-shell {
	display: grid;
	grid-template-columns: 158px minmax(0, 1fr);
	gap: 26px;
	align-items: start;
	width: 100%;
	max-width: 980px;
	margin: 0 auto;
	padding-bottom: 8px;
}

.dch-nav {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	gap: 18px;
}

.dch-brand {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 2px 6px;
}

.dch-brandTile {
	width: 30px;
	height: 30px;
	flex: none;
	display: grid;
	place-items: center;
	border-radius: 9px;
	color: var(--dsw-alias-brand-text);
	background: var(--dsw-alias-brand-primary);
	box-shadow: 0 4px 14px -4px var(--dsw-alias-brand-primary);
}

.dch-brandMeta {
	min-width: 0;
}

.dch-brandName {
	font-size: 13px;
	font-weight: 650;
	line-height: 1.25;
	letter-spacing: 0.01em;
}

.dch-brandTag {
	font-size: 9px;
	font-weight: 600;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: var(--dsw-alias-label-tertiary);
}

.dch-navList {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: ${NAV_GAP}px;
}

.dch-navInd {
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	height: ${NAV_ITEM_H}px;
	border-radius: 11px;
	background: var(--dsw-alias-bg-layer-2);
	border: 1px solid var(--dsw-alias-border-l2);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);
	border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 25%, transparent);
	transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}

.dch-navItem {
	position: relative;
	z-index: 1;
	display: flex;
	align-items: center;
	height: ${NAV_ITEM_H}px;
	padding: 0 12px;
	border: 0;
	border-radius: 11px;
	background: none;
	font: inherit;
	font-size: 13px;
	text-align: left;
	color: var(--dsw-alias-label-tertiary);
	cursor: pointer;
	transition: color 0.22s ease;
}

.dch-navItem:hover {
	color: var(--dsw-alias-label-primary);
}

.dch-navItem.is-active {
	color: var(--dsw-alias-brand-primary);
	font-weight: 600;
}

.dch-navLabel {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* ── page chrome ─────────────────────────────────────────────────────────── */
.dch-page {
	display: flex;
	flex-direction: column;
	gap: 13px;
	min-width: 0;
	animation: dch-page-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes dch-page-in {
	from {
		opacity: 0;
		transform: translateY(12px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

.dch-head {
	margin: 2px 0 5px;
}

.dch-overline {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.18em;
	text-transform: uppercase;
	color: var(--dsw-alias-brand-primary);
	opacity: 0.9;
}

.dch-h1 {
	margin: 4px 0 0;
	font-size: 21px;
	font-weight: 700;
	line-height: 1.3;
	letter-spacing: -0.01em;
	color: var(--dsw-alias-label-primary);
}

.dch-desc {
	margin: 6px 0 0;
	font-size: 12.5px;
	line-height: 1.55;
	color: var(--dsw-alias-label-tertiary);
	max-width: 56ch;
}

.dch-card {
	padding: 18px;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 16px;
	background: var(--dsw-alias-bg-layer-1);
}

/* The card's own padding supplies the outer rhythm, so the first and last rows
   drop their half of it instead of stacking 30px of space inside the frame. */
.dch-card > .dch-field:first-child {
	padding-top: 0;
}

.dch-card > .dch-field:last-child {
	padding-bottom: 0;
}

/* The scenario block: tabs, the line explaining them, an optional variant
   picker, and the staged-profile echo. */
.dch-scenarioHint {
	margin: 10px 0 0;
	font-size: 12px;
	line-height: 1.5;
	color: var(--dsw-alias-label-secondary);
}

.dch-profileEcho {
	margin: 10px 0 0;
	font-size: 12px;
	line-height: 1.5;
	color: var(--dsw-alias-label-tertiary);
}

.dch-code {
	font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
	color: var(--dsw-alias-label-secondary);
}

.dch-field {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 0;
}

.dch-fieldHead {
	display: flex;
	align-items: center;
	gap: 8px;
}

.dch-label {
	flex: 1;
	min-width: 0;
	font-size: 13px;
	font-weight: 500;
	line-height: 1.5;
	color: var(--dsw-alias-label-primary);
}

.dch-badges {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	flex: none;
}

.dch-badge {
	padding: 1px 6px;
	border-radius: var(--dsw-radius-sm);
	font-size: 12px;
	line-height: 1.5;
	background: var(--dsw-alias-bg-layer-4, var(--dsw-alias-bg-layer-3));
	color: var(--dsw-alias-label-secondary);
}

.dch-reset {
	border: none;
	background: none;
	padding: 0;
	font: inherit;
	font-size: 12px;
	line-height: 1.5;
	color: var(--dsw-alias-label-secondary);
	cursor: pointer;
}

.dch-reset:hover:not(:disabled) {
	color: var(--dsw-alias-label-primary);
}

.dch-reset:disabled {
	cursor: default;
}

.dch-control {
	box-sizing: border-box;
	width: 100%;
	height: 34px;
	padding: 0 12px;
	border: 0.5px solid var(--dsw-alias-border-l4);
	border-radius: var(--dsw-radius-md);
	background: var(--dsw-alias-bg-layer-3);
	font: inherit;
	font-size: 13px;
	line-height: 1.5;
	color: var(--dsw-alias-label-primary);
}

.dch-control:focus-visible {
	outline: none;
	border-color: var(--dsw-alias-state-business-primary);
}

.dch-control:disabled {
	color: var(--dsw-alias-label-tertiary);
	cursor: default;
}

.dch-control[aria-invalid='true'] {
	border-color: var(--dsw-alias-state-error-primary);
}

.dch-area {
	height: auto;
	padding: 8px 12px;
	font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
	resize: vertical;
}

.dch-invalid {
	margin: 0;
	font-size: 12px;
	line-height: 1.5;
	color: var(--dsw-alias-state-error-primary);
}

.dch-hint {
	margin: 0;
	font-size: 12px;
	line-height: 1.5;
	color: var(--dsw-alias-label-tertiary);
}

/* ── narrow containers: the rail folds into a strip ──────────────────────── */
@container (max-width: 620px) {
	.dch-shell {
		grid-template-columns: 1fr;
		gap: 14px;
	}
	.dch-nav {
		position: static;
		flex-direction: row;
		align-items: center;
		gap: 10px;
	}
	.dch-brandTag {
		display: none;
	}
	.dch-navList {
		flex: 1;
		flex-direction: row;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.dch-navList::-webkit-scrollbar {
		display: none;
	}
	.dch-navInd {
		display: none;
	}
	.dch-navItem {
		flex: none;
		padding: 0 10px;
	}
	.dch-navItem.is-active {
		background: var(--dsw-alias-bg-layer-2);
	}
}

@container (max-width: 480px) {
	.dch-shell {
		gap: 10px;
	}
	.dch-page {
		gap: 10px;
	}
	.dch-head {
		margin: 0 0 2px;
	}
	.dch-h1 {
		font-size: 18px;
	}
	.dch-desc {
		font-size: 12px;
	}
	.dch-card {
		padding: 14px;
		border-radius: 14px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.dch-page {
		animation: none;
	}
	.dch-navInd {
		transition: none;
	}
}
`

/**
 * Put this page's stylesheet in the document, replacing any earlier copy.
 *
 * @returns a disposer that removes the element this call installed.
 */
export function mountStyles(): () => void {
	const style = document.createElement('style')
	style.id = STYLE_ID
	style.textContent = STYLE_CSS
	const previous = document.getElementById(STYLE_ID)
	if (previous === null) document.head.append(style)
	else previous.replaceWith(style)
	return () => {
		style.remove()
	}
}
