import { type Handle, clientEntry, css } from 'remix/component'
import { on } from '#client/event-mixin.ts'
import { clientEntryId } from '#universal/client-entry.ts'
import { getGhostButtonCss } from '#universal/styles/style-primitives.ts'

export type PendingSubmitButtonProps = {
	label: string
	/** Shown after submit while the (synchronous) request is in flight. */
	pendingLabel: string
	disabled?: boolean
	ariaLabel?: string
	name?: string
	value?: string
}

const ghostCss = css(getGhostButtonCss({ size: 'sm' }))

/**
 * Submit button that disables itself and swaps to `pendingLabel` after the
 * first click so a slow POST cannot double-submit. Without JavaScript it is a
 * plain submit, so the form still works — the pending state is an enhancement.
 */
export const PendingSubmitButton = clientEntry(
	clientEntryId('PendingSubmitButton'),
	PendingSubmitButtonComponent,
)

function PendingSubmitButtonComponent(
	handle: Handle<PendingSubmitButtonProps>,
) {
	let pending = false
	return () => (
		<button
			type="submit"
			name={handle.props.name}
			value={handle.props.value}
			disabled={handle.props.disabled || pending}
			aria-label={handle.props.ariaLabel}
			aria-busy={pending ? 'true' : undefined}
			data-pending-label={handle.props.pendingLabel}
			mix={[
				ghostCss,
				on('click', (event: MouseEvent) => {
					if (pending) {
						event.preventDefault()
						return
					}
					pending = true
					// Macrotask, not microtask: microtasks run before the click
					// default action, and disabling the submitter then aborts
					// the form submission. setTimeout runs after submit starts.
					setTimeout(() => handle.update(), 0)
				}),
			]}
		>
			{pending ? handle.props.pendingLabel : handle.props.label}
		</button>
	)
}
