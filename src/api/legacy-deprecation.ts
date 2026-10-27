// The /api/call and /api/capabilities surface predates /v1. It keeps working
// until v0.3.0 and tells clients where to move (RFC 9745 Deprecation header).
const deprecatedAt = '2026-10-27'
export const legacyCapabilityApiDocsUrl = 'https://github.com/kody-hq/kody-celld/blob/main/docs/api.md'

export function isLegacyCapabilityApiPath(pathname: string) {
	return pathname === '/api/capabilities' || pathname.startsWith('/api/call/')
}

export function withLegacyCapabilityApiDeprecation(response: Response) {
	const headers = new Headers(response.headers)
	headers.set('Deprecation', `@${Date.parse(`${deprecatedAt}T00:00:00.000Z`) / 1000}`)
	headers.set('Link', `<${legacyCapabilityApiDocsUrl}>; rel="deprecation"`)
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
