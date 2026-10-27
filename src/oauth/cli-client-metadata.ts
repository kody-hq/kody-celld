import { oauthScopes } from './protocol.ts'

export const cliClientMetadataPath = '/oauth/cli-client-metadata.json'
export const cliOAuthCallbackUrl = 'http://127.0.0.1:43742/callback'
export const cliOAuthClientName = '@kodycodes/cli'
export const cliOAuthClientUri = 'https://github.com/kody-hq/kody'

export function cliClientId(publicUrl: string) {
	return `${new URL(publicUrl).origin}${cliClientMetadataPath}`
}

export function buildCliClientIdMetadataDocument(publicUrl: string) {
	const origin = new URL(publicUrl).origin
	return {
		client_id: `${origin}${cliClientMetadataPath}`,
		client_name: cliOAuthClientName,
		client_uri: cliOAuthClientUri,
		redirect_uris: [cliOAuthCallbackUrl],
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		application_type: 'native',
		scope: oauthScopes.join(' '),
	}
}

export function cliClientMetadataResponse(request: Request, publicUrl: string) {
	const headers = {
		'cache-control': 'public, max-age=3600',
		'content-type': 'application/json',
		'access-control-allow-origin': '*',
		'access-control-allow-methods': 'GET, HEAD, OPTIONS',
	}
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, HEAD, OPTIONS' } })
	}
	const body = request.method === 'HEAD' ? null : JSON.stringify(buildCliClientIdMetadataDocument(publicUrl))
	return new Response(body, { status: 200, headers })
}
