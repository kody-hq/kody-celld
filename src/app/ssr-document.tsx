import { type Handle, type RemixNode } from 'remix/component'
import { CLIENT_ENTRY_HREF } from '#universal/client-entry.ts'

export const STYLESHEET_HREF = '/styles.css'
export const PAGE_INIT_HREF = '/page-init.js'

export type SsrDocumentProps = {
	title: string
	/** `noindex` for every account/auth page; the self-hosted deploy is private by default. */
	robots?: 'noindex'
	children?: RemixNode
}

/**
 * The `<html>` shell (`packages/worker/src/app/ssr-document.tsx` upstream):
 * icons, self-hosted font preloads, the shared stylesheet, `#root`, and the
 * browser bundle. The Vite build writes the bundle to `public/build/` and
 * celld serves it as a static asset next to `/styles.css`.
 */
export function SsrDocument(handle: Handle<SsrDocumentProps>) {
	return () => (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				{handle.props.robots ? (
					<meta name="robots" content={handle.props.robots} />
				) : null}
				<link rel="icon" href="/favicon.ico" sizes="32x32" />
				<link
					rel="icon"
					type="image/png"
					sizes="32x32"
					href="/favicon-32x32.png"
					media="(prefers-color-scheme: light)"
				/>
				<link
					rel="icon"
					type="image/png"
					sizes="16x16"
					href="/favicon-16x16.png"
					media="(prefers-color-scheme: light)"
				/>
				<link
					rel="icon"
					type="image/png"
					sizes="32x32"
					href="/favicon-32x32-dark.png"
					media="(prefers-color-scheme: dark)"
				/>
				<link
					rel="icon"
					type="image/png"
					sizes="16x16"
					href="/favicon-16x16-dark.png"
					media="(prefers-color-scheme: dark)"
				/>
				<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
				<link
					rel="apple-touch-icon"
					sizes="180x180"
					href="/apple-touch-icon.png"
				/>
				<link rel="manifest" href="/site.webmanifest" />
				{/* Extensions (e.g. Dark Reader) often rewrite the first theme-color
				    meta; keep a second so the document still declares both schemes. */}
				<meta
					name="theme-color"
					content="#e6e8ea"
					media="(prefers-color-scheme: light)"
				/>
				<meta
					name="theme-color"
					content="#111417"
					media="(prefers-color-scheme: dark)"
				/>
				<link
					rel="preload"
					as="font"
					type="font/woff2"
					href="/fonts/bricolage-grotesque-latin.woff2"
					crossOrigin="anonymous"
				/>
				<link
					rel="preload"
					as="font"
					type="font/woff2"
					href="/fonts/wix-madefor-text-latin.woff2"
					crossOrigin="anonymous"
				/>
				<title>{handle.props.title}</title>
				<link rel="stylesheet" href={STYLESHEET_HREF} />
				<script src={PAGE_INIT_HREF}></script>
			</head>
			<body>
				<div id="root">{handle.props.children}</div>
				<script type="module" src={CLIENT_ENTRY_HREF}></script>
			</body>
		</html>
	)
}
