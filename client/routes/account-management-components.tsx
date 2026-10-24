import { css, type Handle, type RemixNode } from 'remix/component'
import { routes } from '#universal/routes.ts'
import { CopyTextButton } from '#client/copy-text-button.tsx'
import { on } from '#client/event-mixin.ts'
import { formatNullableTimestamp } from '#client/format-timestamp.ts'
import {
	colors,
	radius,
	spacing,
	transitions,
	typography,
} from '#universal/styles/tokens.ts'
import {
	getAuthInputCss,
	hoverMq,
	pageGutter,
} from '#universal/styles/style-primitives.ts'
import { type IconName } from '#universal/icon.tsx'
import { getPageShellCss, pageBlockPadding } from '#client/page-layout.ts'
import {
	AccountManagementLinkNav,
	accountManagementNarrowMq,
} from './account-management-link-nav.tsx'

type CssObject = Parameters<typeof css>[0]

export {
	AccountManagementInlineLinkNav,
	AccountManagementLinkNav,
	accountManagementNarrowMq,
} from './account-management-link-nav.tsx'

/*
 * Account-area visual language, ported from the redesign prototype
 * (`landing/account.html` + the `.account-*` blocks in `landing/styles.css`).
 * Sections are hairline-divided (no card chrome), headings speak in the
 * display face, ledes are muted and measured, and nav links are quiet pills
 * that only go green when current.
 */

/** `.account-section` — hairline-topped section, no card chrome. */
const accountSectionCss = {
	borderTop: `1px solid ${colors.border}`,
	paddingTop: 'clamp(2rem, 4vw, 2.75rem)',
	scrollMarginTop: '5.5rem',
	display: 'grid',
	gap: spacing.md,
}

/** `.account-section h2` — display face, quiet weight. */
const accountSectionTitleCss = {
	margin: 0,
	fontSize: '1.35rem',
	fontWeight: 720,
	letterSpacing: '-0.014em',
	color: colors.text,
	lineHeight: 1.2,
}

/** `.account-section > p` — muted lede with a reading measure. */
const accountSectionLedeCss = {
	margin: 0,
	color: colors.textMuted,
	fontSize: '0.98rem',
	maxWidth: '60ch',
	textWrap: 'balance' as const,
}

/** `.field` */
export const accountFieldCss = {
	display: 'grid',
	gap: '0.45rem',
	minWidth: 0,
}

/** `.field label` */
export const accountFieldLabelCss = {
	fontSize: '0.92rem',
	fontWeight: 600,
	color: colors.text,
}

/** `.field input` — the shared auth-field treatment (green border + glow on
 * focus). Inputs must carry `data-field-ring` so the unlayered global
 * `:focus-visible` outline stands down. */
export const accountInputCss = {
	...getAuthInputCss(),
	maxWidth: '100%',
}

export const accountTextareaCss = {
	...accountInputCss,
	resize: 'vertical' as const,
	minHeight: '7rem',
}

/** `.field-note` */
export const accountFieldNoteCss = {
	margin: 0,
	fontSize: '0.92rem',
	color: colors.textMuted,
}

/** `.verified` — the little green status pill next to the account email. */
export const verifiedPillCss = {
	display: 'inline-block',
	fontSize: '0.8rem',
	fontWeight: 600,
	color: colors.primaryText,
	backgroundColor: colors.primarySoft,
	borderRadius: radius.full,
	padding: '0.1rem 0.55rem',
	marginLeft: '0.3rem',
}

/** `.account-actions` — wrapping row of small pill/ghost actions. */
export const accountActionsCss = {
	display: 'flex',
	flexWrap: 'wrap' as const,
	gap: '0.7rem',
}

/**
 * Single-line actions for a table cell: equal-width design-system `sm`
 * ghost buttons on one row. Grid columns share one track size so "Run now"
 * / "Pause" / "Resume" / "Running…" stay the same width; `max-content`
 * keeps the group from stretching into a starved cell and crushing pad —
 * pair with an Actions column width that fits both labels (see jobs list).
 */
export const accountActionsInlineCss = {
	display: 'grid',
	gridAutoFlow: 'column' as const,
	gridAutoColumns: '1fr',
	alignItems: 'center' as const,
	gap: '0.7rem',
	width: 'max-content',
	maxWidth: '100%',
	'& > form': {
		margin: 0,
		minWidth: 0,
	},
	'& > form > button': {
		width: '100%',
		boxSizing: 'border-box' as const,
		// Fits "Run now" / "Running…" / "Resume" at sm ghost padding.
		minWidth: '6.75rem',
	},
	// Card-mode rows (≤620px) put the label beside the value; two side-by-side
	// 6.75rem buttons overflow the value track, so stack them.
	'@container (max-width: 620px)': {
		gridAutoFlow: 'row' as const,
		width: '100%',
	},
}

/** `.account-more` — quiet green disclosure ("Change email"). */
export const accountDisclosureCss = {
	'& > summary': {
		cursor: 'pointer',
		fontWeight: 600,
		color: colors.primaryText,
		width: 'fit-content',
		minHeight: '44px',
		boxSizing: 'border-box' as const,
		paddingBlock: '0.55rem',
		transition: `color ${transitions.fast}`,
	},
	[hoverMq]: {
		'& > summary:hover': { color: colors.text },
	},
	'&[open] > summary': { marginBottom: '0.4rem' },
	'& > :not(summary)': {
		'@media (prefers-reduced-motion: no-preference)': {
			transition: `opacity 200ms ${transitions.easeOut}, translate 200ms ${transitions.easeOut}`,
		},
		'@starting-style': {
			opacity: 0,
			translate: '0 4px',
		},
	},
}

type AccountManagementSlot = RemixNode

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
const accountRailFloors: CssObject = {}
for (let links = 1; links <= accountRailMaxLinks; links++) {
	accountRailFloors[
		`&:has(> [data-account-nav] a:nth-child(${links}):last-child)`
	] = {
		minHeight: `calc(${links} * ${accountRailLinkBlock} + ${pageBlockPadding.top})`,
	}
}
const accountRailFloorCss = { '@media (width > 860px)': accountRailFloors }

export function AccountManagementShell(
	handle: Handle<AccountManagementShellProps>,
) {
	return () => (
		<section
			data-account-shell
			aria-busy={handle.props.busy ? 'true' : undefined}
			mix={css({
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
					...(handle.props.maxWidth
						? {
								'& > *:not([data-account-nav])': {
									maxWidth: handle.props.maxWidth,
								},
							}
						: {}),
					[accountManagementNarrowMq]: {
						paddingLeft: pageGutter,
						gap: spacing.xl,
					},
				},
				...(handle.props.maxWidth
					? {
							'&:not(:has(> [data-account-nav]))': {
								maxWidth: handle.props.maxWidth,
							},
						}
					: {}),
			})}
		>
			{handle.props.children}
		</section>
	)
}

type AccountManagementHeaderProps = {
	title: string
	description: string
	actions?: AccountManagementSlot
	/** Sits under the description (e.g. "Back to jobs") before page chrome. */
	belowDescription?: AccountManagementSlot
}

export function AccountManagementHeader(
	handle: Handle<AccountManagementHeaderProps>,
) {
	return () => (
		<header
			mix={css({
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'flex-start',
				gap: spacing.md,
				flexWrap: 'wrap',
			})}
		>
			<div mix={css({ display: 'grid', gap: '0.55rem' })}>
				<h1
					mix={css({
						fontSize: 'clamp(2rem, 4vw, 2.7rem)',
						fontWeight: 760,
						letterSpacing: '-0.026em',
						lineHeight: 1.08,
						color: colors.text,
						margin: 0,
					})}
				>
					{handle.props.title}
				</h1>
				<p mix={css({ color: colors.textMuted, margin: 0 })}>
					{handle.props.description}
				</p>
				{handle.props.belowDescription ? (
					<div mix={css({ marginTop: '0.15rem' })}>
						{handle.props.belowDescription}
					</div>
				) : null}
			</div>
			{handle.props.actions ? (
				<div
					mix={css({
						display: 'flex',
						gap: spacing.sm,
						flexWrap: 'wrap',
					})}
				>
					{handle.props.actions}
				</div>
			) : null}
		</header>
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

type AccountNavItem = { href: string; label: string; icon: IconName }

/**
 * Account rail items in display order. Upstream gates some entries on feature
 * flags and the session's username; every self-hosted section is always on,
 * so the list is static. Labels follow upstream where the concept matches
 * (Activity = run history, Email = inboxes).
 */
export const accountNavItems: Array<AccountNavItem> = [
	{ href: routes.account.href(), label: 'Overview', icon: 'home' },
	{ href: routes.accountPackages.href(), label: 'Packages', icon: 'box' },
	{
		href: routes.accountActivity.href(),
		label: 'Activity',
		icon: 'trending-up',
	},
	{ href: routes.accountJobs.href(), label: 'Jobs', icon: 'briefcase' },
	{
		href: routes.accountWorkflows.href(),
		label: 'Workflows',
		icon: 'refresh',
	},
	{ href: routes.accountWebhooks.href(), label: 'Webhooks', icon: 'cloud' },
	{ href: routes.accountSecrets.href(), label: 'Secrets', icon: 'key' },
	{
		href: routes.accountIntegrations.href(),
		label: 'Integrations',
		icon: 'plug',
	},
	{
		href: routes.accountMcpServers.href(),
		label: 'MCP servers',
		icon: 'server',
	},
	{
		href: routes.accountMcpOauthClients.href(),
		label: 'MCP clients',
		icon: 'server',
	},
	{ href: routes.accountMemories.href(), label: 'Memories', icon: 'book' },
	{ href: routes.accountEmail.href(), label: 'Email', icon: 'mail' },
	{ href: routes.accountApiTokens.href(), label: 'API tokens', icon: 'link' },
	{ href: routes.accountSessions.href(), label: 'Sessions', icon: 'clock' },
]

function isAccountNavItemActive(itemHref: string, currentPath: string) {
	if (itemHref === '/account') return currentPath === '/account'
	return currentPath === itemHref || currentPath.startsWith(`${itemHref}/`)
}

type AccountPageHeaderProps = {
	title: string
	description: string
	currentHref: string
	actions?: AccountManagementSlot
	belowDescription?: AccountManagementSlot
}

/**
 * Header plus the account-sections subnav. Account pages use this the same
 * way admin pages use AdminPageHeader, so user-specific destinations live
 * under the account layout instead of crowding the top-level nav.
 */
export function AccountPageHeader(handle: Handle<AccountPageHeaderProps>) {
	return () => {
		const currentPath = new URL(handle.props.currentHref, 'http://localhost')
			.pathname

		return (
			<>
				<AccountManagementHeader
					title={handle.props.title}
					description={handle.props.description}
					actions={handle.props.actions}
					belowDescription={handle.props.belowDescription}
				/>
				<AccountManagementLinkNav
					label="Account sections"
					items={accountNavItems.map((item) => ({
						href: item.href,
						label: item.label,
						icon: item.icon,
						active: isAccountNavItemActive(item.href, currentPath),
					}))}
				/>
			</>
		)
	}
}

type AdminPageHeaderProps = {
	title: string
	description: string
	currentHref: string
	actions?: AccountManagementSlot
}

export function AdminPageHeader(handle: Handle<AdminPageHeaderProps>) {
	return () => {
		const currentPath = new URL(handle.props.currentHref, 'http://localhost')
			.pathname

		return (
			<>
				<AccountManagementHeader
					title={handle.props.title}
					description={handle.props.description}
					actions={handle.props.actions}
				/>
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
							(path) =>
								path === currentPath ||
								(path !== routes.admin.href() &&
									currentPath.startsWith(`${path}/`)),
						),
					}))}
				/>
			</>
		)
	}
}

type AccountManagementMessageProps = {
	children: AccountManagementSlot
	tone?: 'info' | 'error'
}

export function AccountManagementMessage(
	handle: Handle<AccountManagementMessageProps>,
) {
	return () => (
		<p
			role={handle.props.tone === 'error' ? 'alert' : 'status'}
			aria-live={handle.props.tone === 'error' ? 'assertive' : 'polite'}
			mix={css({
				color: handle.props.tone === 'error' ? colors.error : colors.text,
				margin: 0,
			})}
		>
			{handle.props.children}
		</p>
	)
}

type AccountManagementPanelProps = {
	id?: string
	title?: string
	description?: string
	children?: AccountManagementSlot
	asForm?: boolean
	onSubmit?: (event: SubmitEvent) => void
	ariaLabel?: string
}

export function AccountManagementPanel(
	handle: Handle<AccountManagementPanelProps>,
) {
	const content = () => (
		<>
			{handle.props.title || handle.props.description ? (
				<div mix={css({ display: 'grid', gap: '0.6rem' })}>
					{handle.props.title ? (
						<h2 mix={css(accountSectionTitleCss)}>{handle.props.title}</h2>
					) : null}
					{handle.props.description ? (
						<p mix={css(accountSectionLedeCss)}>{handle.props.description}</p>
					) : null}
				</div>
			) : null}
			{handle.props.children}
		</>
	)

	return () =>
		handle.props.asForm ? (
			<form
				id={handle.props.id}
				method="post"
				noValidate
				mix={[
					css(accountSectionCss),
					handle.props.onSubmit
						? on('submit', (event) => handle.props.onSubmit?.(event))
						: null,
				]}
			>
				{content()}
			</form>
		) : (
			<section
				id={handle.props.id}
				aria-label={handle.props.ariaLabel}
				mix={css(accountSectionCss)}
			>
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

export function MetadataGrid(handle: Handle<MetadataGridProps>) {
	return () => (
		<dl
			mix={css({
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
			})}
		>
			{handle.props.items.map((item) => (
				<div
					key={item.label}
					mix={css({
						minWidth: 0,
						...(item.wide ? { gridColumn: '1 / -1' } : null),
					})}
				>
					<dt mix={css(accountFieldLabelCss)}>{item.label}</dt>
					<dd
						mix={css({
							margin: 0,
							color: colors.text,
							minWidth: 0,
							// Let children (IdValue, Code, …) choose their own
							// wrap; `anywhere` here forced mid-token breaks in
							// the job-id control.
							overflowWrap: 'break-word',
						})}
					>
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	)
}

/**
 * An identifier is a copy target, not a sentence. Value + Copy share one
 * bordered control (input-group).
 *
 * Default (`copy: 'chip'`, or omitted): one-line ellipsis — table
 * `primaryAccessory` beside an email/name must stay a single chip.
 *
 * `copy: 'ghost'`: wrapping metadata field (job detail) with a normal sm
 * ghost Copy that fills the segment height.
 *
 * The whole string stays in the DOM — wrapping is CSS, never a truncated
 * substring — so a screen reader still reads the id in full, and `user-select:
 * all` turns one click into a whole-value selection for anyone the clipboard
 * button does not work for. `title` is the mouse-hover convenience on top of
 * that, not the mechanism.
 */
export function IdValue(
	handle: Handle<{
		value: string
		/** Field name, so the copy button says which id it takes. */
		label: string
		copy?: 'chip' | 'ghost'
	}>,
) {
	return () => {
		const wrap = handle.props.copy === 'ghost'
		// Soft-wrap at `/` and `#` only when the field is allowed to wrap.
		const displayValue = wrap
			? handle.props.value
					.replaceAll('-', '\u2011')
					.replaceAll('/', '/\u200B')
					.replaceAll('#', '#\u200B')
			: handle.props.value
		return (
			<span
				mix={css({
					display: 'flex',
					alignItems: 'stretch',
					minWidth: wrap ? 0 : '8rem',
					maxWidth: wrap ? '100%' : '12rem',
					flex: wrap ? undefined : '0 1 12rem',
					borderRadius: radius.sm,
					border: `1px solid ${colors.border}`,
					backgroundColor: colors.background,
					overflow: 'hidden',
				})}
			>
				<code
					title={handle.props.value}
					mix={css(
						wrap
							? {
									flex: '1 1 auto',
									minWidth: 0,
									display: 'flex',
									alignItems: 'center',
									overflowWrap: 'break-word',
									hyphens: 'none',
									whiteSpace: 'normal' as const,
									userSelect: 'all' as const,
									fontFamily: 'monospace',
									fontSize: typography.fontSize.sm,
									lineHeight: 1.35,
									// Extra end pad so `#` / last glyph clear the
									// Copy segment divider.
									padding: '0.55rem 0.9rem 0.55rem 0.65rem',
									border: 'none',
									backgroundColor: 'transparent',
									color: colors.text,
								}
							: {
									flex: '1 1 auto',
									minWidth: 0,
									display: 'block',
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap' as const,
									userSelect: 'all' as const,
									fontFamily: 'monospace',
									fontSize: typography.fontSize.sm,
									lineHeight: 1.35,
									padding: '0.4rem 0.55rem',
									border: 'none',
									backgroundColor: 'transparent',
									color: colors.text,
								},
					)}
				>
					{displayValue}
				</code>
				{/* Wrapper owns the segment chrome; `embedded` on the button
				    owns fill/radius on the button's own css() layer. */}
				<span
					mix={css(
						wrap
							? {
									display: 'flex',
									alignItems: 'stretch',
									flex: 'none',
									borderLeft: `1px solid ${colors.border}`,
									backgroundColor: colors.surface,
								}
							: {
									display: 'flex',
									alignItems: 'center',
									flex: 'none',
									borderLeft: `1px solid ${colors.border}`,
									backgroundColor: colors.surface,
									paddingInline: '0.35rem',
								},
					)}
				>
					<CopyTextButton
						value={handle.props.value}
						variant={wrap ? 'ghost' : 'chip'}
						size={wrap ? 'sm' : undefined}
						embedded={wrap || undefined}
						ariaLabel={`Copy ${handle.props.label}`}
					/>
				</span>
			</span>
		)
	}
}

/**
 * A timestamp in a metadata cell reads as one token: a locale string breaking
 * after its comma looks like two values, and tabular figures keep a column of
 * them from shifting sideways as the digits change.
 */
export function TimestampValue(
	handle: Handle<{ value: string | null; fallback?: string }>,
) {
	return () => {
		const label = formatNullableTimestamp(
			handle.props.value,
			handle.props.fallback ?? '—',
		)
		return (
			<span
				title={label}
				mix={css({
					whiteSpace: 'nowrap',
					fontVariantNumeric: 'tabular-nums',
				})}
			>
				{label}
			</span>
		)
	}
}

/**
 * Quiet surface callout, matching the prototype's `.onboard-callout` chrome.
 * The redesign never uses green as a background wash — emphasis lives in the
 * callout's copy and action, not its border.
 */
export const noticeCardCss = {
	display: 'grid',
	gap: spacing.md,
	padding: spacing.lg,
	borderRadius: radius.card,
	border: `1.5px solid ${colors.border}`,
	backgroundColor: colors.surface,
}
