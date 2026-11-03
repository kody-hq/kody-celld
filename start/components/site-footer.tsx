/** @jsxImportSource @emotion/react */
import type { CSSObject } from '@emotion/react'
import { KodyMark } from './kody-mark.tsx'
import { routes } from '#universal/routes.ts'
import { colors, transitions, typography } from '#universal/styles/tokens.ts'
import { layoutMaxWidths, pageGutter } from '#universal/styles/style-primitives.ts'

export type SiteFooterProps = {
	loggedIn: boolean
	loginHref: string
	version: string
}

/**
 * Site footer from the 2026 landing redesign: brand, the tagline voice line,
 * and footer nav. Color scheme follows the system preference. Self-hosted:
 * the nav points at the repository, the upstream product, and this
 * deployment's account page; the version is the running kody-celld release.
 */
export function SiteFooter(props: SiteFooterProps) {
	return (
		<footer css={footerCss}>
			<div css={footerInnerCss}>
				<a href="/" css={brandCss}>
					<KodyMark size={28} />
					<span>Kody</span>
				</a>
				<p css={taglineCss}>
					{props.loggedIn ? (
						'You\u2019re home'
					) : (
						<>
							Self-hosted{' '}
							<a href="https://kody.codes" css={taglineLinkCss}>
								Kody
							</a>
						</>
					)}
				</p>
				<nav aria-label="Footer" css={footerNavCss}>
					<a href={routes.community.href()}>Community</a>
					<a href={routes.brandGuide.href()}>Brand</a>
					<a href="https://github.com/kody-hq/kody-celld/tree/main/docs">Docs</a>
					<a href="https://github.com/kody-hq/kody-celld">Source</a>
					<a href="https://kody.codes">kody.codes</a>
					{props.loggedIn ? <a href="/account">Account</a> : <a href={props.loginHref}>Log in</a>}
					<span>kody-celld {props.version}</span>
				</nav>
			</div>
		</footer>
	)
}

const footerCss: CSSObject = {
	borderTop: `1px solid ${colors.border}`,
	viewTransitionName: 'site-footer',
}

const footerLinkColumnMin = '7.5rem'
/* Stay stacked until the 5-column nav fits beside brand + tagline. */
const footerStackMq = '@media (max-width: 900px)'

const footerInnerCss: CSSObject = {
	maxWidth: layoutMaxWidths.extended,
	marginInline: 'auto',
	paddingBlock: '2.2rem',
	paddingInline: pageGutter,
	display: 'grid',
	gridTemplateColumns: '1fr auto 1fr',
	alignItems: 'center',
	gap: '1.2rem 2rem',
	fontSize: '0.92rem',
	color: colors.textMuted,
	[footerStackMq]: {
		gridTemplateColumns: '1fr',
		justifyItems: 'center',
	},
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

/* The tagline is the voice bit of the footer — display face. */
const taglineCss: CSSObject = {
	margin: 0,
	textAlign: 'center' as const,
	fontFamily: typography.fontFamilyDisplay,
	fontOpticalSizing: 'auto' as const,
}

const taglineLinkCss: CSSObject = {
	color: colors.primaryText,
	fontWeight: 600,
	textDecorationThickness: '1.5px',
	textUnderlineOffset: '3px',
	'&:hover': { color: colors.text },
}

const footerNavCss: CSSObject = {
	/* Wide footer: a two-row, five-column row-major grid, not flex-wrap.
	   Wrapping left the first few links on one row and stacked the rest. */
	display: 'grid',
	gridTemplateColumns: 'repeat(3, max-content)',
	columnGap: '1.4rem',
	rowGap: '0.35rem',
	justifySelf: 'end',
	justifyContent: 'end',
	'& span': { whiteSpace: 'nowrap' as const },
	'& a': {
		color: colors.textMuted,
		textDecoration: 'none',
		whiteSpace: 'nowrap' as const,
		// Same fast color ease as the header nav — one voice for nav links.
		transition: `color ${transitions.fast}`,
	},
	'& a:hover': { color: colors.text },
	/* Stacked footer: wrap into as many columns as the inner measure holds
	   instead of one 10-row ladder or a nowrap row that clips. auto-fit with
	   min(100%, …) collapses to a single column before it overflows. */
	[footerStackMq]: {
		display: 'grid',
		width: '100%',
		gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${footerLinkColumnMin}), max-content))`,
		justifySelf: 'center',
		justifyContent: 'center',
		columnGap: '1.25rem',
		rowGap: '0.15rem',
		'& a, & span': {
			display: 'flex',
			alignItems: 'center',
			minHeight: '44px',
			padding: '0.55rem 0.75rem',
		},
	},
}
