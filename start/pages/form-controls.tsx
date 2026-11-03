/** @jsxImportSource @emotion/react */
import { type ReactNode } from 'react'
import { colors, radius, spacing, typography } from '#universal/styles/tokens.ts'
/*
 * Plain-HTML form building blocks for the server-rendered account, console
 * and auth pages. Every mutation here is a same-origin `POST` carrying the
 * session's CSRF token (`<CsrfInput>`); nothing needs JS to submit, so the
 * pages keep working with scripts disabled. Interactive extras (copy,
 * two-step confirmation) hydrate as islands on top.
 */
type Slot = ReactNode
type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger'
/** `warn` needs attention (no password, not connected); `danger` failed. */
function badgeToneCss(tone: BadgeTone) {
	switch (tone) {
		case 'neutral':
			return { borderColor: colors.border, color: colors.textMuted }
		case 'ok':
			return { borderColor: colors.primary, color: colors.primaryText }
		case 'warn':
			return { borderColor: colors.warning, color: colors.warningText }
		case 'danger':
			return { borderColor: colors.error, color: colors.error }
		default: {
			const unhandled: never = tone
			throw new Error(`Unknown badge tone: ${String(unhandled)}`)
		}
	}
}
export function Badge(props: { children: Slot; tone?: BadgeTone }) {
	return (
		<span
			className="badge"
			css={{
				display: 'inline-block',
				padding: '0.15rem 0.6rem',
				borderRadius: radius.full,
				fontSize: typography.fontSize.sm,
				fontWeight: 600,
				whiteSpace: 'nowrap',
				border: '1px solid',
				backgroundColor: colors.surface,
				...badgeToneCss(props.tone ?? 'neutral'),
			}}
		>
			{props.children}
		</span>
	)
}
export function Code(props: { children: Slot }) {
	return (
		<code
			css={{
				fontFamily: 'monospace',
				fontSize: '0.92em',
				padding: '0.1em 0.35em',
				borderRadius: radius.sm,
				backgroundColor: colors.background,
				border: `1px solid ${colors.border}`,
				overflowWrap: 'anywhere',
			}}
		>
			{props.children}
		</code>
	)
}
export function Muted(props: { children: Slot; small?: boolean }) {
	return (
		<span
			className="muted"
			css={{
				color: colors.textMuted,
				fontSize: props.small ? typography.fontSize.sm : undefined,
			}}
		>
			{props.children}
		</span>
	)
}
/** Preformatted block for JSON dumps, READMEs and install snippets. */
export function PreBlock(props: { children: Slot }) {
	return (
		<pre
			css={{
				margin: 0,
				padding: spacing.md,
				borderRadius: radius.sm,
				border: `1px solid ${colors.border}`,
				backgroundColor: colors.background,
				color: colors.text,
				fontFamily: 'monospace',
				fontSize: typography.fontSize.sm,
				lineHeight: 1.5,
				overflowX: 'auto',
				whiteSpace: 'pre-wrap',
				overflowWrap: 'anywhere',
			}}
		>
			{props.children}
		</pre>
	)
}
