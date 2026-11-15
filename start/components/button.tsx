/** @jsxImportSource @emotion/react */
import type { ComponentProps, JSX } from 'react'
import { getButtonCss, type ButtonStyleOptions } from '#universal/styles/style-primitives.ts'

type ButtonElementProps = ButtonStyleOptions & ComponentProps<'button'> & { href?: undefined }

type ButtonLinkProps = ButtonStyleOptions & ComponentProps<'a'> & { href: string }

export type ButtonProps = ButtonElementProps | ButtonLinkProps

/**
 * The one button. Renders a `<button>`, or a plain `<a>` (document
 * navigation) when given `href`. Extra `css` composes after the shared look,
 * for layout only.
 */
export function Button(props: ButtonLinkProps): JSX.Element
export function Button(props: ButtonElementProps): JSX.Element
export function Button(props: ButtonProps) {
	if (props.href !== undefined) {
		const { variant, size, iconOnly, mobileFullWidth, ...linkProps } = props
		return <a css={getButtonCss({ variant, size, iconOnly, mobileFullWidth })} {...linkProps} />
	}
	const { variant, size, iconOnly, mobileFullWidth, ...buttonProps } = props
	return <button css={getButtonCss({ variant, size, iconOnly, mobileFullWidth })} {...buttonProps} />
}
