/** @jsxImportSource @emotion/react */
import { type ReactNode, type HTMLInputAutoCompleteAttribute } from 'react'
import { getDangerPillCss, getGhostButtonCss, getPillButtonCss } from '#universal/styles/style-primitives.ts'
import {
	accountFieldCss,
	accountFieldLabelCss,
	accountFieldNoteCss,
	accountInputCss,
	accountTextareaCss,
} from './account-management-components.tsx'
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

/** Hidden field carrying the session CSRF token; required on every POST form. */
export function CsrfInput(props: { token: string }) {
	return <input type="hidden" name="csrf" defaultValue={props.token} />
}
export function Hidden(props: { name: string; value: string }) {
	return <input type="hidden" name={props.name} defaultValue={props.value} />
}
type FieldProps = {
	label: string
	name: string
	id?: string
	type?: 'text' | 'email' | 'password' | 'url' | 'search'
	value?: string
	placeholder?: string
	autoComplete?: HTMLInputAutoCompleteAttribute
	autoFocus?: boolean
	required?: boolean
	minLength?: number
	maxLength?: number
	pattern?: string
	note?: string
	multiline?: boolean
	/** Wider label/field for auth screens; default is the account field. */
	size?: 'auth' | 'account'
}
export function Field(props: FieldProps) {
	const p = props
	const id = p.id ?? `field-${p.name}`
	return (
		<div css={accountFieldCss}>
			<label htmlFor={id} css={accountFieldLabelCss}>
				{p.label}
			</label>
			{p.multiline ? (
				<textarea
					id={id}
					name={p.name}
					required={p.required}
					spellCheck={false}
					defaultValue={p.value ?? ''}
					css={accountTextareaCss}
				/>
			) : p.type === 'password' ? (
				<input
					id={id}
					name={p.name}
					type="password"
					placeholder={p.placeholder}
					autoComplete={p.autoComplete}
					autoFocus={p.autoFocus}
					required={p.required}
					minLength={p.minLength}
					maxLength={p.maxLength}
					css={accountInputCss}
				/>
			) : (
				<input
					id={id}
					name={p.name}
					type={p.type ?? 'text'}
					list={undefined}
					defaultValue={p.value}
					placeholder={p.placeholder}
					autoComplete={p.autoComplete}
					autoFocus={p.autoFocus}
					required={p.required}
					minLength={p.minLength}
					maxLength={p.maxLength}
					pattern={p.pattern}
					css={accountInputCss}
				/>
			)}
			{p.note ? <p css={accountFieldNoteCss}>{p.note}</p> : null}
		</div>
	)
}
type ButtonVariant = 'primary' | 'secondary' | 'danger'
type ButtonProps = {
	children: Slot
	/** Green pill, ghost ring, or red ring — kody's redesign button family. */
	variant?: ButtonVariant
	/**
	 * `sm` (default) is what kody's account and admin areas use for in-page
	 * actions. `md` is for the one decisive action on an auth card.
	 */
	size?: 'sm' | 'md'
	name?: string
	value?: string
	disabled?: boolean
	ariaLabel?: string
}
function buttonCss(variant: ButtonVariant, size: 'sm' | 'md') {
	switch (variant) {
		case 'primary':
			return getPillButtonCss({ size })
		case 'secondary':
			return getGhostButtonCss({ size })
		case 'danger':
			return getDangerPillCss({ size })
		default: {
			const unhandled: never = variant
			throw new Error(`Unknown button variant: ${String(unhandled)}`)
		}
	}
}
export function SubmitButton(props: ButtonProps) {
	return (
		<button
			type="submit"
			name={props.name}
			value={props.value}
			disabled={props.disabled}
			aria-label={props.ariaLabel}
			css={buttonCss(props.variant ?? 'primary', props.size ?? 'sm')}
		>
			{props.children}
		</button>
	)
}
/** A stacked form: fields then the submit row, at the account rhythm. */
export function StackedForm(props: { action: string; method?: 'post' | 'get'; autoComplete?: 'off'; children: Slot }) {
	return (
		<form
			method={props.method ?? 'post'}
			action={props.action}
			autoComplete={props.autoComplete}
			css={{ display: 'grid', gap: spacing.md, maxWidth: '36rem' }}
		>
			{props.children}
		</form>
	)
}
