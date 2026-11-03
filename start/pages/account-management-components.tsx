/** @jsxImportSource @emotion/react */
import type { CSSObject } from '@emotion/react'
import { type ReactNode, type FormEvent } from 'react'
import { formatDocumentTimestamp } from '../document-locale.ts'
import { Route as Root } from '../routes/__root.tsx'
import { getAuthInputCss } from '#universal/styles/style-primitives.ts'
import { colors, spacing } from '#universal/styles/tokens.ts'
/*
 * Account-area visual language, ported from the redesign prototype
 * (`landing/account.html` + the `.account-*` blocks in `landing/styles.css`).
 * Sections are hairline-divided (no card chrome), headings speak in the
 * display face, ledes are muted and measured, and nav links are quiet pills
 * that only go green when current.
 */
/** `.account-section` — hairline-topped section, no card chrome. */
const accountSectionCss: CSSObject = {
	borderTop: `1px solid ${colors.border}`,
	paddingTop: 'clamp(2rem, 4vw, 2.75rem)',
	scrollMarginTop: '5.5rem',
	display: 'grid',
	gap: spacing.md,
}
/** `.account-section h2` — display face, quiet weight. */
const accountSectionTitleCss: CSSObject = {
	margin: 0,
	fontSize: '1.35rem',
	fontWeight: 720,
	letterSpacing: '-0.014em',
	color: colors.text,
	lineHeight: 1.2,
}
/** `.account-section > p` — muted lede with a reading measure. */
const accountSectionLedeCss: CSSObject = {
	margin: 0,
	color: colors.textMuted,
	fontSize: '0.98rem',
	maxWidth: '60ch',
	textWrap: 'balance' as const,
}
/** `.field label` */
export const accountFieldLabelCss: CSSObject = {
	fontSize: '0.92rem',
	fontWeight: 600,
	color: colors.text,
}
type AccountManagementSlot = ReactNode
type AccountManagementHeaderProps = {
	title: string
	description: string
	actions?: AccountManagementSlot
	/** Sits under the description (e.g. "Back to jobs") before page chrome. */
	belowDescription?: AccountManagementSlot
}
export function AccountManagementHeader(props: AccountManagementHeaderProps) {
	return (
		<header
			css={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'flex-start',
				gap: spacing.md,
				flexWrap: 'wrap',
			}}
		>
			<div css={{ display: 'grid', gap: '0.55rem' }}>
				<h1
					css={{
						fontSize: 'clamp(2rem, 4vw, 2.7rem)',
						fontWeight: 760,
						letterSpacing: '-0.026em',
						lineHeight: 1.08,
						color: colors.text,
						margin: 0,
					}}
				>
					{props.title}
				</h1>
				<p css={{ color: colors.textMuted, margin: 0 }}>{props.description}</p>
				{props.belowDescription ? <div css={{ marginTop: '0.15rem' }}>{props.belowDescription}</div> : null}
			</div>
			{props.actions ? (
				<div
					css={{
						display: 'flex',
						gap: spacing.sm,
						flexWrap: 'wrap',
					}}
				>
					{props.actions}
				</div>
			) : null}
		</header>
	)
}
type AccountManagementPanelProps = {
	id?: string
	title?: string
	description?: string
	children?: AccountManagementSlot
	asForm?: boolean
	onSubmit?: (event: FormEvent<HTMLFormElement>) => void
	ariaLabel?: string
}
export function AccountManagementPanel(props: AccountManagementPanelProps) {
	const content = () => (
		<>
			{props.title || props.description ? (
				<div css={{ display: 'grid', gap: '0.6rem' }}>
					{props.title ? <h2 css={accountSectionTitleCss}>{props.title}</h2> : null}
					{props.description ? <p css={accountSectionLedeCss}>{props.description}</p> : null}
				</div>
			) : null}
			{props.children}
		</>
	)
	return props.asForm ? (
		<form id={props.id} method="post" noValidate onSubmit={(event) => props.onSubmit?.(event)} css={accountSectionCss}>
			{content()}
		</form>
	) : (
		<section id={props.id} aria-label={props.ariaLabel} css={accountSectionCss}>
			{content()}
		</section>
	)
}
type MetadataGridProps = {
	items: Array<{
		label: string
		value: AccountManagementSlot
		/**
		 * Span the full grid row. Use for a long id control that must stay on
		 * one line at desktop widths (job detail Job id).
		 */
		wide?: boolean
	}>
}
export function MetadataGrid(props: MetadataGridProps) {
	return (
		<dl
			css={{
				display: 'grid',
				// Columns come from the room available rather than a per-page
				// count. A declared `columns={3}` divided the 376px detail pane
				// into 115px columns, which is a third of a UUID. The 14rem floor
				// is what an id needs at the `IdValue` size; below two of those
				// the band is a single column on its own, at every viewport,
				// without a breakpoint having to guess the container's width.
				// The `min()` keeps the floor from overflowing a container
				// narrower than the floor itself.
				// 16rem fits a typical job id + Copy on one or two lines
				// without squeezing the field into a stub beside the button.
				gridTemplateColumns: 'repeat(auto-fit, minmax(min(16rem, 100%), 1fr))',
				gap: spacing.md,
				margin: 0,
			}}
		>
			{props.items.map((item) => (
				<div
					key={item.label}
					css={{
						minWidth: 0,
						...(item.wide ? { gridColumn: '1 / -1' } : null),
					}}
				>
					<dt css={accountFieldLabelCss}>{item.label}</dt>
					<dd
						css={{
							margin: 0,
							color: colors.text,
							minWidth: 0,
							// Let children (IdValue, Code, …) choose their own
							// wrap; `anywhere` here forced mid-token breaks in
							// the job-id control.
							overflowWrap: 'break-word',
						}}
					>
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	)
}
/**
 * A timestamp in a metadata cell reads as one token: a locale string breaking
 * after its comma looks like two values, and tabular figures keep a column of
 * them from shifting sideways as the digits change.
 */
export function TimestampValue(props: { value: string | null; fallback?: string }) {
	const { value, fallback = '—' } = props
	const { timestampLocale } = Root.useLoaderData()
	const label = value ? formatDocumentTimestamp(value, timestampLocale) : fallback
	return (
		<span
			title={label}
			css={{
				whiteSpace: 'nowrap',
				fontVariantNumeric: 'tabular-nums',
			}}
		>
			{label}
		</span>
	)
}

/** `.field` */
export const accountFieldCss: CSSObject = {
	display: 'grid',
	gap: '0.45rem',
	minWidth: 0,
}
/** `.field input` — the shared auth-field treatment (green border + glow on
 * focus). Inputs must carry `data-field-ring` so the unlayered global
 * `:focus-visible` outline stands down. */
export const accountInputCss: CSSObject = {
	...getAuthInputCss(),
	maxWidth: '100%',
}
export const accountTextareaCss: CSSObject = {
	...accountInputCss,
	resize: 'vertical' as const,
	minHeight: '7rem',
}
/** `.field-note` */
export const accountFieldNoteCss: CSSObject = {
	margin: 0,
	fontSize: '0.92rem',
	color: colors.textMuted,
}
