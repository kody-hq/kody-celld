import { createRouter } from '@tanstack/react-router'
import './request-context.ts'
import { readRouterNonce } from './server/router-nonce.ts'
import { routeTree } from './routeTree.gen.ts'

export function getRouter() {
	return createRouter({
		routeTree,
		ssr: { nonce: readRouterNonce() },
		defaultPreload: false,
		caseSensitive: true,
		trailingSlash: 'preserve',
	})
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
