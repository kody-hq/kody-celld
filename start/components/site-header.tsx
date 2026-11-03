/** @jsxImportSource @emotion/react */
import type { CSSObject } from '@emotion/react'
import { useEffect, useState } from 'react'
import { BrandContextMenu } from './brand-context-menu.tsx'
import { KodyMark } from './kody-mark.tsx'
import { UserAvatar } from './user-avatar.tsx'
import { routes } from '#universal/routes.ts'
import { colors, radius, shadows, transitions, typography } from '#universal/styles/tokens.ts'
import { hoverMq, layoutMaxWidths, pageGutter } from '#universal/styles/style-primitives.ts'

export type SiteHeaderProps = {
	loggedIn: boolean
	displayName: string
	avatarUrl: string | null
	showAdminLink: boolean
	loginHref: string
	currentPathname: string
}

/**
 * Sticky site header from the 2026 landing redesign: brand, site nav
 * (Community · Docs), and the session corner (Account then the avatar on
 * desktop). The bottom hairline is a static CSS border so it paints before
 * JS. Self-hosted: Docs points at the repository's docs folder and Admin at
 * the operator console (`/console`); there are no public profiles.
 */
const marketingLinks = [
	{ href: routes.community.href(), label: 'Community' },
	{
		href: 'https://github.com/kody-hq/kody-celld/tree/main/docs',
		label: 'Docs',
	},
] as const

const adminHref = routes.admin.href()

/**
 * `aria-current="page"` for a nav link: exact match, or a subpath of the
 * link's section (`/blog/why` marks Blog).
 */
function ariaCurrent(currentPathname: string, href: string) {
	return currentPathname === href || currentPathname.startsWith(`${href}/`) ? ('page' as const) : undefined
}

/** One id: the invoker points at the panel with `popovertarget`. */
const menuPanelId = 'site-menu'

/**
 * Dismiss an open popover panel on client-side navigation. Older browsers
 * throw from `matches(':popover-open')` when the Popover API is unavailable.
 */
export function dismissOpenPopoverPanel(panel: Element | null) {
	if (!panel || typeof (panel as HTMLElement).hidePopover !== 'function') return
	const element = panel as HTMLElement
	if (element.matches(':popover-open')) {
		element.hidePopover()
	}
}

export function SiteHeader(props: SiteHeaderProps) {
	const [menuOpen, setMenuOpen] = useState(false)
	useEffect(() => {
		dismissOpenPopoverPanel(document.getElementById(menuPanelId))
	}, [props.currentPathname])
	return (
		<header className="site-header" css={headerCss}>
			<nav aria-label="Main" css={navCss}>
				<BrandContextMenu>
					<a href="/" css={brandCss}>
						<KodyMark size={34} />
						<span>Kody</span>
					</a>
				</BrandContextMenu>
				<div css={navLinksCss}>
					{marketingLinks.map((link) => (
						<a key={link.href} href={link.href} aria-current={ariaCurrent(props.currentPathname, link.href)}>
							{link.label}
						</a>
					))}
					{props.showAdminLink ? (
						<a href={adminHref} aria-current={ariaCurrent(props.currentPathname, adminHref)}>
							Admin
						</a>
					) : null}
				</div>
				<div css={navActionsCss}>
					{props.loggedIn ? (
						<>
							<a
								href={routes.account.href()}
								aria-current={ariaCurrent(props.currentPathname, routes.account.href())}
								data-testid="site-header-account"
								css={navAccountCss}
							>
								Account
							</a>
							<span aria-hidden="true" data-testid="site-header-profile" css={navUserAvatarCss}>
								<UserAvatar displayName={props.displayName} avatarUrl={props.avatarUrl} size={32} variant="well" />
							</span>
						</>
					) : (
						<a href={props.loginHref} css={navLoginCss}>
							Log in
						</a>
					)}
				</div>
				<button
					type="button"
					popoverTarget={menuPanelId}
					aria-label="Menu"
					aria-expanded={menuOpen ? 'true' : 'false'}
					data-open={menuOpen ? '' : undefined}
					css={menuToggleCss}
				>
					<span aria-hidden="true" css={burgerCss}>
						<span />
						<span />
						<span />
					</span>
				</button>
				<div
					id={menuPanelId}
					popover="auto"
					css={menuPanelCss}
					onToggle={(event) => setMenuOpen(event.newState === 'open')}
				>
					<div css={menuGroupCss}>
						{marketingLinks.map((link) => (
							<a key={link.href} href={link.href} aria-current={ariaCurrent(props.currentPathname, link.href)}>
								{link.label}
							</a>
						))}
						{props.showAdminLink ? (
							<a href={adminHref} aria-current={ariaCurrent(props.currentPathname, adminHref)}>
								Admin
							</a>
						) : null}
					</div>
					<div css={menuGroupCss}>
						{props.loggedIn ? (
							<>
								<span data-testid="site-header-profile-menu" css={menuProfileLinkCss}>
									<UserAvatar displayName={props.displayName} avatarUrl={props.avatarUrl} size={32} variant="well" />
									{props.displayName}
								</span>
								<a
									href={routes.account.href()}
									aria-current={ariaCurrent(props.currentPathname, routes.account.href())}
									data-testid="site-header-account-menu"
								>
									Account
								</a>
							</>
						) : (
							<a href={props.loginHref}>Log in</a>
						)}
					</div>
				</div>
			</nav>
		</header>
	)
}

const headerCss: CSSObject = {
	position: 'sticky' as const,
	top: 0,
	zIndex: 10,
	viewTransitionName: 'site-header',
	background: `oklch(from ${colors.background} l c h / 0.85)`,
	'@supports (backdrop-filter: blur(1px))': {
		backdropFilter: 'blur(14px)',
	},
}

const navCss: CSSObject = {
	maxWidth: layoutMaxWidths.extended,
	marginInline: 'auto',
	padding: `0.8rem ${pageGutter}`,
	display: 'flex',
	alignItems: 'center',
	gap: '1.8rem',
	flexWrap: 'wrap' as const,
}

const brandCss: CSSObject = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: '0.6rem',
	minHeight: '44px',
	font: `700 1.25rem/1 ${typography.fontFamilyDisplay}`,
	color: colors.text,
	textDecoration: 'none',
	letterSpacing: '-0.01em',
	'&:hover': { color: colors.text },
}

/**
 * Below this the inline nav and session corner would crowd the brand, so both
 * fold into the menu panel. Wider than the mobile token: it is the width the
 * links themselves stop fitting, not a device class.
 */
const headerNavMq = '@media (max-width: 820px)'

const navLinksCss: CSSObject = {
	display: 'flex',
	gap: '1.6rem',
	marginRight: 'auto',
	'& a': {
		color: colors.textMuted,
		textDecoration: 'none',
		fontWeight: 500,
		fontSize: '0.98rem',
		transition: `color ${transitions.fast}`,
	},
	'& a:hover': { color: colors.text },
	'& a[aria-current="page"]': { color: colors.text },
	[headerNavMq]: { display: 'none' },
}

const navActionsCss: CSSObject = {
	display: 'flex',
	alignItems: 'center',
	gap: '0.9rem',
	// The links are gone at this width, so the actions take the free space
	// and keep the toggle pinned to the right edge.
	[headerNavMq]: { display: 'none' },
}

const menuToggleCss: CSSObject = {
	display: 'none',
	marginLeft: 'auto',
	alignItems: 'center',
	justifyContent: 'center',
	width: '44px',
	height: '44px',
	padding: 0,
	borderRadius: '12px',
	border: `1.5px solid ${colors.border}`,
	background: 'transparent',
	color: colors.text,
	cursor: 'pointer',
	transition: `border-color ${transitions.fast}, background-color ${transitions.fast}, scale ${transitions.fast}`,
	'&:active': { scale: '0.94' },
	[hoverMq]: {
		'&:hover': { borderColor: colors.textMuted },
	},
	'@media (prefers-reduced-motion: reduce)': {
		'&:active': { scale: 'none' },
	},
	[headerNavMq]: { display: 'inline-flex' },
}

/** Three rules that fold into a cross. Transform-only, so it stays composited. */
const burgerCss: CSSObject = {
	display: 'grid',
	gap: '4px',
	width: '18px',
	'& > span': {
		display: 'block',
		height: '2px',
		borderRadius: '2px',
		backgroundColor: 'currentColor',
		transition: `translate 180ms ${transitions.easeOut}, rotate 180ms ${transitions.easeOut}, opacity 120ms ${transitions.easeOut}, scale 120ms ${transitions.easeOut}`,
	},
	// The end state still changes under reduced motion — only the tweening goes.
	'@media (prefers-reduced-motion: reduce)': {
		'& > span': { transition: 'none' },
	},
	'[data-open] &> span:nth-child(1)': { translate: '0 6px', rotate: '45deg' },
	'[data-open] &> span:nth-child(2)': { opacity: 0, scale: '0.4' },
	'[data-open] &> span:nth-child(3)': { translate: '0 -6px', rotate: '-45deg' },
}

/**
 * The menu is a native popover: the top layer, light dismiss, Escape, and
 * focus return all come from the platform, and the entrance is a plain
 * transition thanks to `@starting-style` plus discrete `display`/`overlay`.
 * 180ms, the dropdown budget — this opens often enough that it must not
 * make anyone wait.
 */
const menuPanelCss: CSSObject = {
	position: 'fixed' as const,
	inset: 'auto' as const,
	top: '4.15rem',
	left: pageGutter,
	right: pageGutter,
	width: 'auto',
	maxWidth: 'none',
	maxHeight: 'calc(100dvh - 5.5rem)',
	overflowY: 'auto' as const,
	margin: 0,
	padding: '0.5rem',
	// No base `display`: a closed popover must keep the UA's `display: none`,
	// or the invisible fixed panel keeps swallowing taps where the menu was.
	// The `display … allow-discrete` transition holds `grid` through the exit.
	gap: '0.35rem',
	border: `1.5px solid ${colors.border}`,
	borderRadius: '18px',
	backgroundColor: colors.surface,
	boxShadow: shadows.md,
	color: colors.text,
	opacity: 0,
	translate: '0 -8px',
	scale: '0.98',
	transformOrigin: 'top center',
	transition: `opacity 180ms ${transitions.easeOut}, translate 180ms ${transitions.easeOut}, scale 180ms ${transitions.easeOut}, display 180ms allow-discrete, overlay 180ms allow-discrete`,
	'&:popover-open': {
		display: 'grid',
		opacity: 1,
		translate: '0 0',
		scale: '1',
		'@starting-style': {
			opacity: 0,
			translate: '0 -8px',
			scale: '0.98',
		},
	},
	'&::backdrop': {
		backgroundColor: 'oklch(0 0 0 / 0.4)',
		opacity: 0,
		transition: `opacity 180ms ${transitions.easeOut}, display 180ms allow-discrete, overlay 180ms allow-discrete`,
	},
	'&:popover-open::backdrop': {
		opacity: 1,
		'@starting-style': { opacity: 0 },
	},
	'@media (prefers-reduced-motion: reduce)': {
		translate: 'none',
		scale: 'none',
		transition: `opacity 120ms ${transitions.easeOut}, display 120ms allow-discrete, overlay 120ms allow-discrete`,
	},
	// Desktop never sees it; the inline nav is the menu there. `:popover-open`
	// is repeated so this outranks the open state's `display: grid`.
	'@media (min-width: 821px)': {
		display: 'none',
		'&:popover-open': { display: 'none' },
	},
}

const menuGroupCss: CSSObject = {
	display: 'grid',
	gap: '0.15rem',
	'& + &': {
		marginTop: '0.35rem',
		paddingTop: '0.5rem',
		borderTop: `1px solid ${colors.border}`,
	},
	'& a': {
		display: 'flex',
		alignItems: 'center',
		// Comfortable target on a phone, not a cramped text link.
		minHeight: '44px',
		padding: '0 0.85rem',
		borderRadius: '12px',
		color: colors.text,
		textDecoration: 'none',
		fontWeight: 550,
		fontSize: '1rem',
		transition: `background-color ${transitions.fast}, color ${transitions.fast}`,
	},
	'& a[aria-current="page"]': {
		color: colors.primaryText,
		backgroundColor: colors.primarySoft,
	},
	'& a:active': { backgroundColor: colors.primarySoftest },
	[hoverMq]: {
		'& a:hover': { backgroundColor: colors.primarySoftest },
	},
}

const navLoginCss: CSSObject = {
	fontWeight: 550,
	fontSize: '0.98rem',
	color: colors.text,
	textDecoration: 'none',
	padding: '0.7rem 0.25rem',
	whiteSpace: 'nowrap' as const,
	'&:hover': { color: colors.primaryText },
}

const navAccountCss: CSSObject = {
	color: colors.textMuted,
	textDecoration: 'none',
	fontWeight: 500,
	fontSize: '0.98rem',
	whiteSpace: 'nowrap' as const,
	transition: `color ${transitions.fast}`,
	'&:hover': { color: colors.text },
	'&[aria-current="page"]': { color: colors.text },
}

const navUserAvatarCss: CSSObject = {
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	lineHeight: 0,
	padding: '0.15rem',
	borderRadius: radius.full,
	textDecoration: 'none',
	color: colors.textMuted,
	'&:hover': { color: colors.text },
}

const menuProfileLinkCss: CSSObject = {
	gap: '0.65rem',
}
