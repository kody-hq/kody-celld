import { createRouter } from '@tanstack/react-router'
import './request-context.ts'
import { readRouterNonce } from './server/router-nonce.ts'
import { routeTree } from './routeTree.gen.ts'
import { opaquePathname } from '#universal/opaque-pathname.ts'

export function getRouter() {
	const publicPathnames = new Map<string, string>()
	return createRouter({
		routeTree,
		ssr: { nonce: readRouterNonce() },
		defaultPreload: false,
		caseSensitive: true,
		trailingSlash: 'preserve',
		rewrite: {
			input({ url }) {
				const pathname = opaquePathname(url.pathname)
				if (pathname !== url.pathname) {
					// The Worker owns decoding and errors. Keep rejected URI bytes
					// opaque to Start without changing this document's public URL.
					publicPathnames.set(pathname, url.pathname)
					url.pathname = pathname
				}
				return url
			},
			output({ url }) {
				url.pathname = publicPathnames.get(url.pathname) ?? url.pathname
				return url
			},
		},
	})
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
