import {
	type Handle,
	clientEntry,
	css,
	ref,
	type RemixNode,
} from 'remix/component'
import { clientEntryId } from '#universal/client-entry.ts'
import { writeClipboardText } from '#client/clipboard.ts'
import { on } from '#client/event-mixin.ts'
import { toast } from '#client/toast.ts'
import { kodyLogoOutlinedSvgMarkup } from '#universal/brand/kody-logo.ts'
import {
	kodyBrandAssets,
	kodyMarkOutlinedSvgMarkup,
} from '#universal/brand/kody-mark-path.ts'
import { hoverMq } from '#universal/styles/style-primitives.ts'
import { colors, shadows, transitions } from '#universal/styles/tokens.ts'

export type BrandContextMenuProps = {
	children: RemixNode
}

type PlateTone = 'light' | 'dark'

type BrandFile = { href: string; filename: string }

/** One downloadable treatment: a preview, its SVG, and an optional PNG. */
type BrandVariant = {
	id: string
	label: string
	tone: PlateTone
	shape: 'logo' | 'mark' | 'tile'
	preview: string
	svg?: BrandFile
	png: BrandFile
}

type MenuItem =
	| {
			kind: 'action'
			id: string
			label: string
			run: () => void | Promise<void>
	  }
	| { kind: 'link'; id: string; label: string; href: string }

const brandVariants: Array<BrandVariant> = [
	{
		id: 'logo-light',
		label: 'Logo (light)',
		tone: 'light',
		shape: 'logo',
		preview: kodyBrandAssets.logoSvgOutlined,
		svg: {
			href: kodyBrandAssets.logoSvgOutlined,
			filename: 'kody-logo-outlined.svg',
		},
		png: {
			href: kodyBrandAssets.logoPngOutlined,
			filename: 'kody-logo-outlined.png',
		},
	},
	{
		id: 'logo-dark',
		label: 'Logo (dark)',
		tone: 'dark',
		shape: 'logo',
		preview: kodyBrandAssets.logoSvgWhite,
		svg: {
			href: kodyBrandAssets.logoSvgWhite,
			filename: 'kody-logo-white.svg',
		},
		png: {
			href: kodyBrandAssets.logoPngWhite,
			filename: 'kody-logo-white.png',
		},
	},
	{
		id: 'mark-light',
		label: 'Mark (light)',
		tone: 'light',
		shape: 'mark',
		preview: kodyBrandAssets.svgOutlined,
		svg: {
			href: kodyBrandAssets.svgOutlined,
			filename: 'kody-mark-outlined.svg',
		},
		png: {
			href: kodyBrandAssets.pngOutlined,
			filename: 'kody-mark-outlined.png',
		},
	},
	{
		id: 'mark-dark',
		label: 'Mark (dark)',
		tone: 'dark',
		shape: 'mark',
		preview: kodyBrandAssets.svgWhite,
		svg: { href: kodyBrandAssets.svgWhite, filename: 'kody-mark-white.svg' },
		png: { href: kodyBrandAssets.pngWhite, filename: 'kody-mark-white.png' },
	},
	{
		id: 'tile-light',
		label: 'App icon (light)',
		tone: 'light',
		shape: 'tile',
		preview: kodyBrandAssets.svgOutlined,
		png: {
			href: kodyBrandAssets.pngOutlinedSolidLight,
			filename: 'kody-mark-outlined-solid-light.png',
		},
	},
	{
		id: 'tile-dark',
		label: 'App icon (dark)',
		tone: 'dark',
		shape: 'tile',
		preview: kodyBrandAssets.svgWhite,
		png: {
			href: kodyBrandAssets.pngSolidDark,
			filename: 'kody-mark-solid-dark.png',
		},
	},
]

const guideItem: MenuItem = {
	kind: 'link',
	id: 'brand-guide',
	label: 'All brand assets',
	href: kodyBrandAssets.guide,
}

const menuPanelId = 'kody-brand-context-menu'

/**
 * Brand context menu: right-click (or the context-menu key) on the mark or
 * wordmark opens a popover that previews every logo, mark, and app-icon
 * variant. A row downloads its SVG (or the PNG when that is the only format);
 * the trailing chip downloads the PNG. Left click on the child still
 * navigates home.
 */
export const BrandContextMenu = clientEntry(
	clientEntryId('BrandContextMenu'),
	BrandContextMenuComponent,
)

function BrandContextMenuComponent(handle: Handle<BrandContextMenuProps>) {
	let open = false
	let coords = { x: 0, y: 0 }
	let activeIndex = 0
	let menuNode: HTMLElement | null = null
	let rootNode: HTMLElement | null = null
	let disposeDocument: (() => void) | null = null

	async function copySvg(markup: string, what: string) {
		try {
			await writeClipboardText(markup)
			toast.success('Copied SVG to clipboard', {
				id: 'kody-brand-svg-copied',
				description: `Outlined light-mode ${what} markup is ready to paste.`,
			})
		} catch {
			toast.error('Could not copy SVG', {
				id: 'kody-brand-svg-copy-failed',
				description: 'Download it from the brand guide instead.',
			})
		}
	}

	function download(file: BrandFile) {
		const anchor = document.createElement('a')
		anchor.href = file.href
		anchor.download = file.filename
		anchor.rel = 'noopener'
		document.body.append(anchor)
		anchor.click()
		anchor.remove()
	}

	const copyItems: Array<MenuItem> = [
		{
			kind: 'action',
			id: 'copy-logo-svg',
			label: 'Copy logo as SVG',
			run: () => copySvg(kodyLogoOutlinedSvgMarkup('#000000'), 'logo'),
		},
		{
			kind: 'action',
			id: 'copy-mark-svg',
			label: 'Copy mark as SVG',
			run: () => copySvg(kodyMarkOutlinedSvgMarkup('#000000'), 'mark'),
		},
	]

	const variantItems = brandVariants.map((variant) => {
		const primary = variant.svg ?? variant.png
		const format = variant.svg ? 'SVG' : 'PNG'
		const row: MenuItem = {
			kind: 'action',
			id: variant.id,
			label: `Download ${variant.label} ${format}`,
			run: () => download(primary),
		}
		const chip: MenuItem | null = variant.svg
			? {
					kind: 'action',
					id: `${variant.id}-png`,
					label: `Download ${variant.label} PNG`,
					run: () => download(variant.png),
				}
			: null
		return { variant, format, row, chip }
	})

	const items = [
		...copyItems,
		...variantItems.flatMap(({ row, chip }) => (chip ? [row, chip] : [row])),
		guideItem,
	]

	function close(options?: { restoreFocus?: boolean }) {
		disposeDocument?.()
		disposeDocument = null
		if (menuNode && typeof menuNode.hidePopover === 'function') {
			try {
				menuNode.hidePopover()
			} catch {
				// Closed already or Popover API unavailable.
			}
		}
		open = false
		activeIndex = 0
		handle.update()
		if (options?.restoreFocus) {
			const focusTarget = rootNode?.querySelector<HTMLElement>(
				'a, button, [tabindex]:not([tabindex="-1"])',
			)
			focusTarget?.focus()
		}
	}

	async function activate(item: MenuItem) {
		close({ restoreFocus: true })
		if (item.kind === 'link') {
			window.location.assign(item.href)
			return
		}
		await item.run()
	}

	function clampCoords() {
		if (!menuNode) return
		const rect = menuNode.getBoundingClientRect()
		const margin = 8
		const x = Math.max(
			margin,
			Math.min(coords.x, window.innerWidth - rect.width - margin),
		)
		const y = Math.max(
			margin,
			Math.min(coords.y, window.innerHeight - rect.height - margin),
		)
		if (x !== coords.x || y !== coords.y) {
			coords = { x, y }
			handle.update()
		}
	}

	function bindDocument() {
		disposeDocument?.()
		function onPointerDown(event: PointerEvent) {
			const target = event.target as Node | null
			if (!target) return
			if (menuNode?.contains(target)) return
			if (rootNode?.contains(target) && event.button === 2) return
			close()
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault()
				close({ restoreFocus: true })
				return
			}
			const target = event.target
			const focusInsideMenu =
				target instanceof Node && Boolean(menuNode?.contains(target))
			if (!focusInsideMenu) {
				close()
				return
			}
			if (event.key === 'Tab') {
				close()
				return
			}
			if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
				event.preventDefault()
				activeIndex = (activeIndex + 1) % items.length
				handle.update()
				return
			}
			if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
				event.preventDefault()
				activeIndex = (activeIndex - 1 + items.length) % items.length
				handle.update()
				return
			}
			if (event.key === 'Home') {
				event.preventDefault()
				activeIndex = 0
				handle.update()
				return
			}
			if (event.key === 'End') {
				event.preventDefault()
				activeIndex = items.length - 1
				handle.update()
				return
			}
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault()
				const item = items[activeIndex]
				if (!item) return
				void activate(item)
			}
		}
		function onFocusOut(event: FocusEvent) {
			const next = event.relatedTarget
			if (next instanceof Node && menuNode?.contains(next)) return
			close()
		}
		function onResize() {
			close()
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('keydown', onKey, true)
		window.addEventListener('resize', onResize)
		menuNode?.addEventListener('focusout', onFocusOut)
		const boundMenu = menuNode
		disposeDocument = () => {
			document.removeEventListener('pointerdown', onPointerDown, true)
			document.removeEventListener('keydown', onKey, true)
			window.removeEventListener('resize', onResize)
			boundMenu?.removeEventListener('focusout', onFocusOut)
		}
	}

	function openAt(clientX: number, clientY: number) {
		coords = { x: clientX, y: clientY + 4 }
		activeIndex = 0
		open = true
		handle.update()
		queueMicrotask(() => {
			menuNode = document.getElementById(menuPanelId)
			if (menuNode && typeof menuNode.showPopover === 'function') {
				try {
					menuNode.showPopover()
				} catch {
					// Already open.
				}
			}
			clampCoords()
			bindDocument()
			const active = menuNode?.querySelector<HTMLElement>(
				`[data-menu-index="${activeIndex}"]`,
			)
			active?.focus()
		})
	}

	function onContextMenu(event: MouseEvent) {
		event.preventDefault()
		event.stopPropagation()
		openAt(event.clientX, event.clientY)
	}

	function onKeyDown(event: KeyboardEvent) {
		if (
			event.key === 'ContextMenu' ||
			(event.shiftKey && event.key === 'F10')
		) {
			event.preventDefault()
			const rect = rootNode?.getBoundingClientRect()
			if (!rect) return
			openAt(rect.left + rect.width / 2, rect.bottom)
		}
	}

	function itemIndex(item: MenuItem) {
		return items.indexOf(item)
	}

	return () => (
		<div
			mix={[
				css({ display: 'inline-flex' }),
				on('contextmenu', onContextMenu),
				on('keydown', onKeyDown),
				ref((node, signal) => {
					rootNode = node as HTMLElement
					signal.addEventListener('abort', () => {
						if (rootNode === node) rootNode = null
					})
				}),
			]}
		>
			{handle.props.children}
			{open ? (
				<div
					id={menuPanelId}
					role="menu"
					aria-label="Kody brand"
					popover="manual"
					style={`left: ${coords.x}px; top: ${coords.y}px`}
					mix={[
						css(menuCss),
						ref((node, signal) => {
							menuNode = node as HTMLElement
							signal.addEventListener('abort', () => {
								if (menuNode === node) menuNode = null
							})
						}),
					]}
				>
					{copyItems.map((item) => (
						<button
							key={item.id}
							type="button"
							role="menuitem"
							data-menu-index={itemIndex(item)}
							tabIndex={itemIndex(item) === activeIndex ? 0 : -1}
							data-active={itemIndex(item) === activeIndex ? '' : undefined}
							mix={[
								css(textItemCss),
								on('mouseenter', () => {
									activeIndex = itemIndex(item)
									handle.update()
								}),
								on('click', () => void activate(item)),
							]}
						>
							{item.label}
						</button>
					))}
					<div role="separator" mix={css(separatorCss)} />
					{variantItems.map(({ variant, format, row, chip }) => (
						<div key={variant.id} mix={css(variantRowCss)}>
							<button
								type="button"
								role="menuitem"
								data-menu-index={itemIndex(row)}
								tabIndex={itemIndex(row) === activeIndex ? 0 : -1}
								data-active={itemIndex(row) === activeIndex ? '' : undefined}
								aria-label={row.label}
								mix={[
									css(variantItemCss),
									on('mouseenter', () => {
										activeIndex = itemIndex(row)
										handle.update()
									}),
									on('click', () => void activate(row)),
								]}
							>
								<span mix={css(variantLabelCss)}>
									{variant.label}
									<span>{format}</span>
								</span>
								<span
									mix={[css(plateCss), css(plateShapeCss[variant.shape])]}
									data-tone={variant.tone}
								>
									<img src={variant.preview} alt="" />
								</span>
							</button>
							{chip ? (
								<button
									type="button"
									role="menuitem"
									data-menu-index={itemIndex(chip)}
									tabIndex={itemIndex(chip) === activeIndex ? 0 : -1}
									data-active={itemIndex(chip) === activeIndex ? '' : undefined}
									aria-label={chip.label}
									mix={[
										css(chipCss),
										on('mouseenter', () => {
											activeIndex = itemIndex(chip)
											handle.update()
										}),
										on('click', () => void activate(chip)),
									]}
								>
									PNG
								</button>
							) : (
								<span mix={css(chipSpacerCss)} />
							)}
						</div>
					))}
					<div role="separator" mix={css(separatorCss)} />
					<button
						type="button"
						role="menuitem"
						data-menu-index={itemIndex(guideItem)}
						tabIndex={itemIndex(guideItem) === activeIndex ? 0 : -1}
						data-active={itemIndex(guideItem) === activeIndex ? '' : undefined}
						mix={[
							css(textItemCss),
							on('mouseenter', () => {
								activeIndex = itemIndex(guideItem)
								handle.update()
							}),
							on('click', () => void activate(guideItem)),
						]}
					>
						{guideItem.label}
					</button>
				</div>
			) : null}
		</div>
	)
}

const menuCss = {
	position: 'fixed' as const,
	zIndex: 1000,
	inset: 'auto' as const,
	width: 'min(21rem, calc(100vw - 1rem))',
	margin: 0,
	padding: '0.35rem',
	display: 'grid',
	gap: '0.1rem',
	border: `1.5px solid ${colors.border}`,
	borderRadius: '12px',
	backgroundColor: colors.surface,
	boxShadow: shadows.md,
	color: colors.text,
	maxHeight: 'calc(100dvh - 16px)',
	overflowY: 'auto' as const,
	overscrollBehavior: 'contain' as const,
}

const activeItemCss = {
	'&[data-active], &:focus-visible': {
		backgroundColor: colors.primarySoftest,
		outline: 'none',
	},
	[hoverMq]: {
		'&:hover': { backgroundColor: colors.primarySoftest },
	},
}

const baseItemCss = {
	border: 0,
	borderRadius: '8px',
	background: 'transparent',
	color: colors.text,
	font: 'inherit',
	fontSize: '0.92rem',
	fontWeight: 550,
	textAlign: 'left' as const,
	cursor: 'pointer',
	transition: `background-color ${transitions.fast}`,
	...activeItemCss,
}

const textItemCss = {
	...baseItemCss,
	display: 'flex',
	alignItems: 'center',
	minHeight: '2.25rem',
	padding: '0 0.75rem',
}

const separatorCss = {
	height: '1px',
	margin: '0.3rem 0.5rem',
	backgroundColor: colors.border,
}

const variantRowCss = {
	display: 'grid',
	gridTemplateColumns: 'minmax(0, 1fr) auto',
	alignItems: 'center',
	gap: '0.25rem',
}

const variantItemCss = {
	...baseItemCss,
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: '0.75rem',
	minHeight: '3rem',
	padding: '0.35rem 0.5rem 0.35rem 0.75rem',
}

const variantLabelCss = {
	display: 'grid',
	gap: '0.1rem',
	'& > span': {
		font: '600 0.68rem/1 ui-monospace, "SF Mono", Menlo, monospace',
		letterSpacing: '0.06em',
		color: colors.textMuted,
	},
}

const plateCss = {
	flex: 'none',
	display: 'grid',
	placeItems: 'center',
	height: '2.25rem',
	boxShadow: `0 0 0 1px ${colors.border}`,
	'&[data-tone="light"]': { backgroundColor: '#ffffff' },
	'&[data-tone="dark"]': { backgroundColor: '#000000' },
	'& img': { display: 'block', height: '1.35rem', width: 'auto' },
}

const plateShapeCss = {
	logo: { padding: '0 0.85rem', borderRadius: '999px' },
	mark: { padding: '0 0.7rem', borderRadius: '999px' },
	tile: {
		width: '2.25rem',
		borderRadius: '9px',
		'& img': { height: 'auto', width: '1.55rem' },
	},
} as const satisfies Record<BrandVariant['shape'], object>

const chipCss = {
	...baseItemCss,
	minWidth: '2.75rem',
	height: '2rem',
	padding: '0 0.5rem',
	textAlign: 'center' as const,
	font: '600 0.7rem/1 ui-monospace, "SF Mono", Menlo, monospace',
	letterSpacing: '0.06em',
	color: colors.textMuted,
	boxShadow: `inset 0 0 0 1px ${colors.border}`,
}

const chipSpacerCss = {
	minWidth: '2.75rem',
}
