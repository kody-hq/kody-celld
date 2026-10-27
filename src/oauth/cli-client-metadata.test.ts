import assert from 'node:assert/strict'
import test from 'node:test'
import {
	buildCliClientIdMetadataDocument,
	cliClientId,
	cliClientMetadataPath,
	cliClientMetadataResponse,
} from './cli-client-metadata.ts'

const publicUrl = 'https://celld.example/'

test('official CLI client metadata matches the celld OAuth server', () => {
	assert.deepEqual(buildCliClientIdMetadataDocument(publicUrl), {
		client_id: `https://celld.example${cliClientMetadataPath}`,
		client_name: '@kodycodes/cli',
		client_uri: 'https://github.com/kody-hq/kody',
		redirect_uris: ['http://127.0.0.1:43742/callback'],
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		application_type: 'native',
		scope: 'openid profile email',
	})
	assert.equal(cliClientId(publicUrl), `https://celld.example${cliClientMetadataPath}`)
})

test('official CLI metadata route serves GET, HEAD, and OPTIONS with public cache headers', async () => {
	const get = cliClientMetadataResponse(new Request(`https://celld.example${cliClientMetadataPath}`), publicUrl)
	assert.equal(get.status, 200)
	assert.equal(get.headers.get('content-type'), 'application/json')
	assert.equal(get.headers.get('cache-control'), 'public, max-age=3600')
	assert.deepEqual(await get.json(), buildCliClientIdMetadataDocument(publicUrl))

	const head = cliClientMetadataResponse(
		new Request(`https://celld.example${cliClientMetadataPath}`, { method: 'HEAD' }),
		publicUrl,
	)
	assert.equal(head.status, 200)
	assert.equal(await head.text(), '')
	assert.equal(head.headers.get('cache-control'), 'public, max-age=3600')

	const options = cliClientMetadataResponse(
		new Request(`https://celld.example${cliClientMetadataPath}`, { method: 'OPTIONS' }),
		publicUrl,
	)
	assert.equal(options.status, 204)
	assert.equal(options.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS')
	assert.equal(options.headers.get('cache-control'), 'public, max-age=3600')
})
