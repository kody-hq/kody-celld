import { type Handle, css } from 'remix/component'
import {
	kodyMarkAspectRatio,
	kodyMarkOutlinedLeftEyePathD,
	kodyMarkOutlinedNosePathD,
	kodyMarkOutlinedRightEyePathD,
	kodyMarkOutlinedRingPathD,
	kodyMarkPathD,
	kodyMarkPathTransform,
	kodyMarkViewBox,
} from '#universal/brand/kody-mark-path.ts'

type KodyMarkVariant = 'auto' | 'solid' | 'outlined'

export type KodyMarkProps = {
	/** Rendered height in CSS pixels; width follows the natural aspect ratio. */
	size?: number
	/**
	 * `auto` (default): outlined line-art in light color scheme, solid fill in
	 * dark. `outlined` / `solid` force one treatment (for side-by-side previews).
	 */
	variant?: KodyMarkVariant
	/** Accessible name. Empty string keeps the mark decorative when a nearby label exists. */
	title?: string
}

/**
 * Inline Kody mark. Light mode uses the outlined filled-path treatment; dark
 * mode uses the solid fill. Both share the same viewBox and silhouette
 * footprint so theme swaps do not shift layout. Ink follows `currentColor`.
 *
 * Theme switching uses an SVG `<style>` media query (same approach as
 * `favicon.svg`) so `prefers-color-scheme` applies reliably inside SVG.
 */
export function KodyMark(handle: Handle<KodyMarkProps>) {
	return () => {
		const size = handle.props.size ?? 34
		const variant = handle.props.variant ?? 'auto'
		const title = handle.props.title ?? ''
		const width = Math.round(size * kodyMarkAspectRatio)
		const labelled = title.trim().length > 0
		const showOutlined = variant === 'outlined' || variant === 'auto'
		const showSolid = variant === 'solid' || variant === 'auto'

		return (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox={kodyMarkViewBox}
				width={width}
				height={size}
				mix={css({ display: 'block', flexShrink: 0, color: 'inherit' })}
				role={labelled ? 'img' : undefined}
				aria-hidden={labelled ? undefined : true}
				aria-label={labelled ? title : undefined}
				focusable={false}
			>
				{labelled ? <title>{title}</title> : null}
				{variant === 'auto' ? (
					<style>{`.kody-mark-outlined{display:inline}.kody-mark-solid{display:none}@media (prefers-color-scheme: dark){.kody-mark-outlined{display:none}.kody-mark-solid{display:inline}}`}</style>
				) : null}
				{showOutlined ? (
					<g class={variant === 'auto' ? 'kody-mark-outlined' : undefined}>
						<path
							fill="currentColor"
							fill-rule="evenodd"
							transform={kodyMarkPathTransform}
							d={kodyMarkOutlinedRingPathD}
						/>
						<path
							fill="currentColor"
							transform={kodyMarkPathTransform}
							d={kodyMarkOutlinedLeftEyePathD}
						/>
						<path
							fill="currentColor"
							transform={kodyMarkPathTransform}
							d={kodyMarkOutlinedRightEyePathD}
						/>
						<path
							fill="currentColor"
							transform={kodyMarkPathTransform}
							d={kodyMarkOutlinedNosePathD}
						/>
					</g>
				) : null}
				{showSolid ? (
					<path
						class={variant === 'auto' ? 'kody-mark-solid' : undefined}
						fill="currentColor"
						fill-rule="evenodd"
						transform={kodyMarkPathTransform}
						d={kodyMarkPathD}
					/>
				) : null}
			</svg>
		)
	}
}
