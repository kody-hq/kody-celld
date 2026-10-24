import assert from 'node:assert/strict'
import test from 'node:test'
import { maxApiRequestBodyBytes, mergeApiParams, readJsonBody, readQueryParams } from './request-params.ts'

test('coerces query values from schema and collects repeated array keys', () => {
	const params = readQueryParams(new URLSearchParams('limit=4&enabled=false&tag=one&tag=two&org=ignored'), {
		type: 'object',
		properties: {
			limit: { type: 'integer' },
			enabled: { type: 'boolean' },
			tag: { type: 'array', items: { type: 'string' } },
		},
	})
	assert.deepEqual(params, { limit: 4, enabled: false, tag: ['one', 'two'] })
})

test('rejects duplicate scalar query values', () => {
	assert.throws(
		() => readQueryParams(new URLSearchParams('limit=1&limit=2'), { properties: { limit: { type: 'integer' } } }),
		{ message: 'Query parameter "limit" must appear once.' },
	)
})

test('rejects conflicting path and query values with the hosted message', () => {
	assert.throws(() => mergeApiParams({ id: 'path' }, { id: 'query' }), {
		message: '"id" is set by the URL path and must not differ in the query or body.',
	})
})

test('enforces the request body byte limit', async () => {
	const request = new Request('https://example.test/v1/packages', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(maxApiRequestBodyBytes + 1))
				controller.close()
			},
		}),
		duplex: 'half',
	} as RequestInit)
	assert.equal(request.headers.has('content-length'), false)
	const response = await readJsonBody(request)
	assert.equal(response.kind, 'too_large')
	if (response.kind === 'too_large') assert.equal(response.byteLength, maxApiRequestBodyBytes + 1)
})

test('rejects non-JSON request bodies', async () => {
	assert.deepEqual(
		await readJsonBody(
			new Request('https://example.test/v1/packages', {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: 'body',
			}),
		),
		{ kind: 'unsupported_media_type' },
	)
})
