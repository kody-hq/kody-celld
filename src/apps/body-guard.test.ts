import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { guardAppBody } from './body-guard.ts'

const encoder = new TextEncoder()

function chunks(...parts: Array<string>) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const part of parts) controller.enqueue(encoder.encode(part))
			controller.close()
		},
	})
}

/** A body that sends one chunk and then never finishes; `cancelled` flips when the guard gives up on it. */
function stalled() {
	const state = { cancelled: false }
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode('first'))
		},
		cancel() {
			state.cancelled = true
		},
	})
	return { body, state }
}

function recorder() {
	const failures: Array<{ name: string; message: string }> = []
	return { failures, onFailure: (error: { name: string; message: string }) => failures.push(error) }
}

describe('guardAppBody', () => {
	it('passes a body through untouched when it fits the cap and the deadline', async () => {
		const { failures, onFailure } = recorder()
		const body = guardAppBody(chunks('he', 'llo'), {
			deadlineAt: Date.now() + 5000,
			maxBytes: 5,
			onFailure,
			timeoutMs: 5000,
		})
		assert.equal(await new Response(body).text(), 'hello')
		assert.deepEqual(failures, [])
	})

	it('errors the stream and records once when the byte cap is exceeded', async () => {
		const { failures, onFailure } = recorder()
		const body = guardAppBody(chunks('abc', 'def', 'ghi'), {
			deadlineAt: Date.now() + 5000,
			maxBytes: 5,
			onFailure,
			timeoutMs: 5000,
		})
		await assert.rejects(new Response(body).text(), /more than 5 bytes/)
		assert.equal(failures.length, 1)
		assert.equal(failures[0]?.name, 'app_response_too_large')
	})

	it('errors the stream, cancels the app body and records once when the deadline passes', async () => {
		const { failures, onFailure } = recorder()
		const { body, state } = stalled()
		const guarded = guardAppBody(body, { deadlineAt: Date.now() + 50, maxBytes: 1000, onFailure, timeoutMs: 50 })
		await assert.rejects(new Response(guarded).text(), /did not finish its response/)
		assert.equal(failures.length, 1)
		assert.equal(failures[0]?.name, 'app_timeout')
		assert.equal(state.cancelled, true)
	})

	it('records an app body that errors mid-stream', async () => {
		const { failures, onFailure } = recorder()
		const broken = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(new Error('boom'))
			},
		})
		const guarded = guardAppBody(broken, { deadlineAt: Date.now() + 5000, maxBytes: 1000, onFailure, timeoutMs: 5000 })
		await assert.rejects(new Response(guarded).text())
		assert.deepEqual(failures, [{ name: 'app_stream_error', message: 'boom' }])
	})

	it('records nothing when the browser cancels, and stops the deadline timer', async () => {
		const { failures, onFailure } = recorder()
		const { body, state } = stalled()
		const guarded = guardAppBody(body, { deadlineAt: Date.now() + 50, maxBytes: 1000, onFailure, timeoutMs: 5000 })
		const reader = guarded.getReader()
		await reader.read()
		await reader.cancel()
		await new Promise((resolve) => setTimeout(resolve, 100))
		assert.deepEqual(failures, [])
		assert.equal(state.cancelled, true)
	})
})
