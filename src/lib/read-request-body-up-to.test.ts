import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readRequestBodyUpTo } from './read-request-body-up-to.ts'

// Cases ported from hosted packages/worker/src/read-request-body-up-to.node.test.ts (vitest).
function chunkedRequest(chunks: Array<Uint8Array>, headers: Record<string, string> = {}) {
	let pulled = 0
	let cancelled = false
	const body = new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				const chunk = chunks[pulled]
				if (!chunk) {
					controller.close()
					return
				}
				pulled += 1
				controller.enqueue(chunk)
			},
			cancel() {
				cancelled = true
			},
		},
		{ highWaterMark: 0 },
	)
	const request = new Request('https://example.test/', {
		method: 'POST',
		headers,
		body,
		duplex: 'half',
	} as RequestInit)
	return {
		request,
		pulled: () => pulled,
		cancelled: () => cancelled,
	}
}

describe('readRequestBodyUpTo', () => {
	it('stops reading a chunked body once it passes the cap', async () => {
		const chunk = new Uint8Array(1024)
		const source = chunkedRequest(Array.from({ length: 100 }, () => chunk))
		assert.equal(source.request.headers.get('Content-Length'), null)
		assert.deepEqual(await readRequestBodyUpTo(source.request, 4096), { ok: false, byteLength: 5120 })
		assert.ok(source.pulled() < 10)
		assert.equal(source.cancelled(), true)
	})

	it('refuses a declared Content-Length over the cap without reading', async () => {
		const source = chunkedRequest([new Uint8Array(16)], { 'Content-Length': '999999' })
		assert.deepEqual(await readRequestBodyUpTo(source.request, 4096), { ok: false, byteLength: 999999 })
		assert.equal(source.pulled(), 0)
	})

	it('returns the whole body at or under the cap', async () => {
		const source = chunkedRequest([new TextEncoder().encode('hello '), new TextEncoder().encode('world')])
		const result = await readRequestBodyUpTo(source.request, 11)
		assert.ok(result.ok)
		assert.equal(new TextDecoder().decode(result.bytes), 'hello world')
	})

	it('returns empty bytes for a bodyless request', async () => {
		const result = await readRequestBodyUpTo(new Request('https://example.test/', { method: 'POST' }), 10)
		assert.deepEqual(result, { ok: true, bytes: new Uint8Array() })
	})
})
