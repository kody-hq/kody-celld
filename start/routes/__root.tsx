/** @jsxImportSource @emotion/react */
import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { createIsomorphicFn, getGlobalStartContext } from '@tanstack/react-start'
import { AppShell } from '../app-shell.tsx'

const readDocument = createIsomorphicFn()
	.server(() => {
		const document = getGlobalStartContext()?.document
		if (!document) throw new Error('Document rendering requires request data')
		return document
	})
	.client(() => {
		throw new Error('Document navigation requires a full request')
	})

export const Route = createRootRoute({
	loader: () => readDocument(),
	shellComponent: Document,
	component: Outlet,
	errorComponent: () => <p role="alert">This page could not be displayed.</p>,
})

function Document({ children }: { children: ReactNode }) {
	const data = Route.useLoaderData()
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="robots" content="noindex" />
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
				<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				<link rel="manifest" href="/site.webmanifest" />
				{/* Extensions (e.g. Dark Reader) often rewrite the first theme-color
				    meta; keep a second so the document still declares both schemes. */}
				<meta name="theme-color" content="#e6e8ea" media="(prefers-color-scheme: light)" />
				<meta name="theme-color" content="#111417" media="(prefers-color-scheme: dark)" />
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
				<title>{data.title}</title>
				<link rel="stylesheet" href="/styles.css" />
				{data.data.page === 'accountSecrets' || ('issued' in data.data && data.data.issued) ? (
					<script src="/one-time-document.js"></script>
				) : null}
				<script src="/page-init.js"></script>
				<HeadContent />
			</head>
			<body>
				<div id="root">
					<AppShell document={data}>{children}</AppShell>
				</div>
				<script src="/emotion-style-hoist.js"></script>
				<Scripts />
			</body>
		</html>
	)
}
