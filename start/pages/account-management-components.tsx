/** @jsxImportSource @emotion/react */
import type { CSSObject } from '@emotion/react'
import { type ReactNode, type FormEvent } from 'react'
import { routes } from '#universal/routes.ts'
import { type IconName } from '#universal/icon-names.ts'
import { getPageShellCss, pageBlockPadding } from '#client/page-layout.ts'
import { AccountManagementLinkNav, accountManagementNarrowMq } from './account-management-link-nav.tsx'
import { formatDocumentTimestamp } from '../document-locale.ts'
import { Route as Root } from '../routes/__root.tsx'
import { getAuthInputCss, pageGutter } from '#universal/styles/style-primitives.ts'
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

type AccountManagementShellProps = {
	/**
	 * Optional cap on the content column (not the whole grid). Useful for
	 * pages whose forms read better on a narrower measure.
	 */
	maxWidth?: string
	/**
	 * The route is refetching this location while its last good content stays
	 * on screen (`createRouteData` snapshot `pending` with data). Marks the
	 * shell `aria-busy` and announces it to assistive tech without moving
	 * layout. Leave unset on the cold path where the route shows its own
	 * loading copy.
	 */
	busy?: boolean
	children: AccountManagementSlot
}

/** Prototype `.account` section rhythm: margin between blocks in the content column. */
const accountSectionGap = 'clamp(2rem, 4vw, 2.75rem)'

/** One rail link (0.5rem padding × 2, a 0.98rem line, the 0.15rem gap). */
const accountRailLinkBlock = '2.6rem'
const accountRailMaxLinks = 16

/**
 * The absolute rail adds no height, so a page shorter than its rail (Activity
 * with no runs) would scroll the last links out of view. The floor is sized
 * to the links actually rendered — never the fixed height that left a blank
 * band under the three-link console rail — and only applies while the rail
 * is beside the content.
 */
const accountRailFloors: CSSObject = {}
for (let links = 1; links <= accountRailMaxLinks; links++) {
	accountRailFloors[`&:has(> [data-account-nav] a:nth-child(${links}):last-child)`] = {
		minHeight: `calc(${links} * ${accountRailLinkBlock} + ${pageBlockPadding.top})`,
	}
}
const accountRailFloorCss = { '@media (width > 860px)': accountRailFloors }

export function AccountManagementShell(props: AccountManagementShellProps) {
	return (
		<section
			data-account-shell
			aria-busy={props.busy ? 'true' : undefined}
			css={{
				// The shared page box (width, gutter, vertical rhythm), so the
				// rail and content column line up with the header brand on every
				// account and console page regardless of how much each renders.
				...getPageShellCss('app'),
				display: 'grid',
				gap: spacing.xl,
				alignItems: 'start',
				// Flash already adds top rhythm; tighten this shell's own
				// paddingTop on the same `css()` layer so it beats
				// `pageBlockPadding.top` (an ancestor `main` rule loses to
				// this class's cascade sub-layer).
				'main:has(> [data-page-flash]) > &': {
					paddingTop: spacing.sm,
				},
				// Prototype `.account` layout: 200px rail beside the content
				// column, 72rem total. The rail is absolutely positioned in a
				// left track and only exists when the section nav is present —
				// nav-less shell users (onboarding, pending verification) keep
				// the plain column. The rail starts at the gutter so it lines
				// up with the header's brand. Its box is the shell (top and
				// bottom), floored at the rail's own height, and the link
				// column scrolls inside that box on a short viewport. Note:
				// `css()` classes each live in their own cascade sub-layer, so
				// child spacing must stay on the shell's `gap`, never on
				// per-child margins a child's own class would silently beat.
				...accountRailFloorCss,
				'&:has(> [data-account-nav])': {
					position: 'relative',
					gap: accountSectionGap,
					paddingLeft: `calc(${pageGutter} + 200px + clamp(2rem, 5vw, 4.5rem))`,
					alignContent: 'start',
					...(props.maxWidth
						? {
								'& > *:not([data-account-nav])': {
									maxWidth: props.maxWidth,
								},
							}
						: {}),
					[accountManagementNarrowMq]: {
						paddingLeft: pageGutter,
						gap: spacing.xl,
					},
				},
				...(props.maxWidth
					? {
							'&:not(:has(> [data-account-nav]))': {
								maxWidth: props.maxWidth,
							},
						}
					: {}),
			}}
		>
			{props.children}
		</section>
	)
}
const adminNavItems = [
	{
		href: routes.adminUsers.href(),
		label: 'Users',
		icon: 'users',
		paths: [routes.admin.href(), routes.adminUsers.href(), '/console/users'],
	},
	{
		href: routes.adminAudit.href(),
		label: 'Audit log',
		icon: 'shield',
		paths: [routes.adminAudit.href()],
	},
	{
		href: routes.adminConfig.href(),
		label: 'Configuration',
		icon: 'code',
		paths: [routes.adminConfig.href()],
	},
] as const satisfies ReadonlyArray<{
	href: string
	label: string
	icon: IconName
	paths: ReadonlyArray<string>
}>

type AdminPageHeaderProps = {
	title: string
	description: string
	currentHref: string
	actions?: AccountManagementSlot
}

export function AdminPageHeader(props: AdminPageHeaderProps) {
	const currentPath = new URL(props.currentHref, 'http://localhost').pathname

	return (
		<>
			<AccountManagementHeader title={props.title} description={props.description} actions={props.actions} />
			<AccountManagementLinkNav
				label="Admin sections"
				items={adminNavItems.map((item) => ({
					href: item.href,
					label: item.label,
					icon: item.icon,
					// Prefix-aware like account nav so `/console/users/42`
					// keeps Users highlighted. `/console` stays exact-only
					// so sibling pages (`/console/audit`, …) are unaffected.
					active: item.paths.some(
						(path) => path === currentPath || (path !== routes.admin.href() && currentPath.startsWith(`${path}/`)),
					),
				}))}
			/>
		</>
	)
}
