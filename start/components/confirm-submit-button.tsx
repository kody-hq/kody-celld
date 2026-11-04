/** @jsxImportSource @emotion/react */
import { useState } from 'react'
import { getDangerPillCss, getGhostButtonCss } from '#universal/styles/style-primitives.ts'

/** Confirmation enhances the native submit; without JavaScript, the form still submits. */
export function ConfirmSubmitButton(props: {
	label: string
	confirmLabel?: string
	variant?: 'danger' | 'ghost'
	name?: string
	value?: string
	formAction?: string
}) {
	const [armed, setArmed] = useState(false)
	return (
		<button
			type="submit"
			name={props.name}
			value={props.value}
			formAction={props.formAction}
			aria-live="polite"
			css={props.variant === 'ghost' ? getGhostButtonCss({ size: 'sm' }) : getDangerPillCss({ size: 'sm' })}
			onBlur={() => setArmed(false)}
			onClick={(event) => {
				if (!armed) {
					event.preventDefault()
					setArmed(true)
				} else {
					setArmed(false)
				}
			}}
		>
			{armed ? (props.confirmLabel ?? 'Are you sure?') : props.label}
		</button>
	)
}
