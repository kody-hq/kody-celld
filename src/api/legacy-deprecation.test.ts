import assert from 'node:assert/strict'
import test from 'node:test'
import {
	isLegacyCapabilityApiPath,
	legacyCapabilityApiDocsUrl,
	withLegacyCapabilityApiDeprecation,
} from './legacy-deprecation.ts'

test('marks only the legacy capability routes as deprecated', () => {
	assert.equal(isLegacyCapabilityApiPath('/api/call/packageList'), true)
	assert.equal(isLegacyCapabilityApiPath('/api/capabilities'), true)
	assert.equal(isLegacyCapabilityApiPath('/api/blobs/photos/cat.png'), false)
	assert.equal(isLegacyCapabilityApiPath('/api/webhooks/hook/url'), false)
	assert.equal(isLegacyCapabilityApiPath('/v1/packages'), false)
})

test('adds Deprecation and Link headers and keeps the response', async () => {
	const response = withLegacyCapabilityApiDeprecation(
		Response.json({ ok: true }, { status: 201, headers: { 'cache-control': 'no-store' } }),
	)
	assert.equal(response.status, 201)
	assert.equal(response.headers.get('Deprecation'), '@1793059200')
	assert.equal(response.headers.get('Link'), `<${legacyCapabilityApiDocsUrl}>; rel="deprecation"`)
	assert.equal(response.headers.get('cache-control'), 'no-store')
	assert.deepEqual(await response.json(), { ok: true })
})
