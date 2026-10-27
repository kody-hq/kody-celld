import { assert, baseUrl, log } from './lib.mjs'

async function request(path, { method = 'GET', token, body } = {}) {
	const response = await fetch(`${baseUrl}${path}`, {
		method,
		headers: {
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	let json
	try {
		json = await response.json()
	} catch {
		json = null
	}
	return { status: response.status, json }
}

export async function smokeApi({ token }) {
	const openapi = await request('/openapi.json')
	assert(openapi.status === 200, 'OpenAPI returned an unexpected status', openapi)
	assert(openapi.json.paths?.['/v1/packages'], 'OpenAPI should list package routes', openapi.json)
	log('openapi', { packageRoutes: Object.keys(openapi.json.paths['/v1/packages']) })

	const etag = (await fetch(`${baseUrl}/openapi.json`, { method: 'HEAD' })).headers.get('etag')
	const notModified = await fetch(`${baseUrl}/openapi.json`, { headers: { 'if-none-match': etag ?? '' } })
	assert(etag && notModified.status === 304, 'OpenAPI should return 304 for a matching ETag', {
		etag,
		status: notModified.status,
	})

	const unauthenticated = await request('/v1/packages')
	assert(
		unauthenticated.status === 401 && unauthenticated.json?.error?.code === 'unauthorized',
		'unauthenticated package request should return the API 401 shape',
		unauthenticated,
	)

	const packages = await request('/v1/packages', { token })
	assert(
		packages.status === 200 && Array.isArray(packages.json?.packages),
		'authenticated package list failed',
		packages,
	)
	log('GET /v1/packages', { count: packages.json.packages.length })

	const memorySubject = `v1 api smoke ${Date.now()}`
	const memorySummary = `API smoke memory ${memorySubject}`
	const createdMemory = await request('/v1/memories', {
		method: 'POST',
		token,
		body: { subject: memorySubject, summary: memorySummary },
	})
	assert(
		createdMemory.status === 200 && typeof createdMemory.json?.memory?.id === 'string',
		'API memory creation failed',
		createdMemory,
	)
	const listedMemories = await request(`/v1/memories?query=${encodeURIComponent(memorySubject)}`, { token })
	assert(
		listedMemories.status === 200 &&
			listedMemories.json?.matches?.some((memory) => memory.id === createdMemory.json.memory.id),
		'API memory search did not return the created memory',
		listedMemories,
	)
	log('memory API create/list', createdMemory.json.memory.id)

	const secrets = await request('/v1/secrets', { token })
	assert(secrets.status === 200 && Array.isArray(secrets.json?.secrets), 'API secrets list failed', secrets)
	log('GET /v1/secrets', { count: secrets.json.secrets.length })

	const webhooks = await request('/v1/webhooks', { token })
	assert(webhooks.status === 200 && Array.isArray(webhooks.json?.webhooks), 'API webhooks list failed', webhooks)
	log('GET /v1/webhooks', { count: webhooks.json.webhooks.length })

	const executed = await request('/v1/execute', {
		method: 'POST',
		token,
		body: { code: 'export default async function main() { return 42 }', params: {} },
	})
	assert(
		executed.status === 200 &&
			executed.json?.isError === false &&
			executed.json?.structuredContent?.ok === true &&
			executed.json.structuredContent.result === 42,
		'HTTP execute should return the MCP execute envelope',
		executed,
	)
	log('POST /v1/execute', executed.json.structuredContent.result)

	const unknown = await request('/v1/unknown-route', { token })
	assert(
		unknown.status === 404 &&
			unknown.json?.error?.code === 'not_found' &&
			unknown.json.error.message === 'No route for GET /v1/unknown-route. See /openapi.json.',
		'unknown API route should return the hosted error shape',
		unknown,
	)
	log('unknown route', unknown.json.error)
}
