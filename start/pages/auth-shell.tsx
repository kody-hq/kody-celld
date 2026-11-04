/** @jsxImportSource @emotion/react */
import type { ReactNode } from 'react'
import { KodyMark } from '../components/kody-mark.tsx'
import { routes } from '#universal/routes.ts'
import { getSurfaceCardCss } from '#universal/styles/style-primitives.ts'
import { colors, spacing } from '#universal/styles/tokens.ts'
import { getPageShellCss } from '#client/page-layout.ts'
/**
 * Centred single-card layout for the stand-alone pages (sign-in, setup,
 * consent, connect). Same silhouette as kody's `/login`: brand mark on top,
 * display-face title, muted lede, then the form.
 */
export function AuthShell(props: { title: string; description?: ReactNode; wide?: boolean; children: ReactNode }) {
	return (
		<section
			css={{
				...getPageShellCss(props.wide ? 'authWide' : 'auth'),
				// No site header above these pages, so the card sits lower.
				paddingTop: 'clamp(2rem, 6vw, 4rem)',
				display: 'grid',
				gap: spacing.lg,
			}}
		>
			<a
				href={routes.home.href()}
				css={{
					display: 'inline-flex',
					alignItems: 'center',
					gap: spacing.sm,
					justifySelf: 'start',
					color: colors.text,
					textDecoration: 'none',
					fontWeight: 700,
					fontSize: '1.1rem',
				}}
			>
				<KodyMark size={34} />
				<span>Kody</span>
			</a>
			{/* A client-chosen name (OAuth consent) can be one unbroken word; let
			    it wrap instead of widening the page on narrow screens. */}
			<div css={{ display: 'grid', gap: '0.5rem', overflowWrap: 'anywhere' }}>
				<h1
					css={{
						margin: 0,
						fontSize: 'clamp(1.8rem, 4vw, 2.3rem)',
						fontWeight: 760,
						letterSpacing: '-0.024em',
						lineHeight: 1.1,
						color: colors.text,
					}}
				>
					{props.title}
				</h1>
				{props.description ? <p css={{ margin: 0, color: colors.textMuted }}>{props.description}</p> : null}
			</div>
			<div
				css={{
					...getSurfaceCardCss(),
					display: 'grid',
					gap: spacing.lg,
					padding: 'clamp(1.25rem, 3vw, 2rem)',
				}}
			>
				{props.children}
			</div>
		</section>
	)
}
/** Divided sub-block inside the auth card (e.g. alternate sign-in methods). */
export function AuthSection(props: { title?: string; children: ReactNode; first?: boolean }) {
	return (
		<div
			css={{
				display: 'grid',
				gap: spacing.md,
				...(props.first
					? {}
					: {
							borderTop: `1px solid ${colors.border}`,
							paddingTop: spacing.lg,
						}),
			}}
		>
			{props.title ? (
				<h2
					css={{
						margin: 0,
						fontSize: '1.05rem',
						fontWeight: 700,
						color: colors.text,
					}}
				>
					{props.title}
				</h2>
			) : null}
			{props.children}
		</div>
	)
}
