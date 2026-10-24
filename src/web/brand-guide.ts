import { renderPage } from '#app/render.tsx'
import type { Env } from '../env.ts'
import { appSessionOf } from './http.ts'
import { readWebSession } from './session.ts'

/** Public brand guide. No sign-in; assets are downloadable from this page. */
export function isBrandGuideRoute(pathname: string) {
	return pathname === '/brand-guide' || pathname === '/brand-guide/'
}

export async function handleBrandGuide(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('method not allowed', {
			status: 405,
			headers: { allow: 'GET, HEAD' },
		})
	}
	const session = appSessionOf(await readWebSession(request, env))
	return renderPage({
		title: 'Brand guide',
		pathname: '/brand-guide',
		session,
		data: { page: 'brandGuide' },
	})
}
