import { createRouter, defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router'
import './request-context.ts'
import { readRouterNonce } from './server/router-nonce.ts'
import { routeTree } from './routeTree.gen.ts'
import { opaquePathname } from '#universal/opaque-pathname.ts'

export function getRouter() {
	const publicPathnames = new Map<string, string>()
	const publicSearches = new Map<string, string>()
	return createRouter({
		routeTree,
		ssr: { nonce: readRouterNonce() },
		defaultPreload: false,
		caseSensitive: true,
		trailingSlash: 'preserve',
		rewrite: {
			input({ url }) {
				const search = defaultStringifySearch(defaultParseSearch(url.search))
				// The Worker owns URL decoding. Hydration must not navigate away
				// from its document just to canonicalize equivalent URI bytes.
				publicSearches.set(search, url.search)
				const pathname = opaquePathname(url.pathname)
				publicPathnames.set(pathname, url.pathname)
				url.pathname = pathname
				return url
			},
			output({ url }) {
				url.pathname = publicPathnames.get(url.pathname) ?? url.pathname
				url.search = publicSearches.get(url.search) ?? url.search
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
