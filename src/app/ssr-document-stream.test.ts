import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDocumentStream } from './ssr-document-stream.ts'

describe('openDocumentStream', () => {
	it('prefixes legacy markup, but leaves Start documents with exactly one doctype', async () => {
		for (const prependDoctype of [true, false]) {
			const input = `${prependDoctype ? '' : '<!DOCTYPE html>'}<html><body>OK</body></html>`
			const stream = await openDocumentStream(new Response(input).body!, {
				prependDoctype,
			})
			assert.equal(
				await new Response(stream).text(),
				'<!DOCTYPE html><html><body>OK</body></html>',
			)
		}
	})
	it('rejects a failed or empty renderer before returning a response body', async () => {
		for (const prependDoctype of [true, false]) {
			await assert.rejects(
				() =>
					openDocumentStream(
						new ReadableStream({
							start(controller) {
								controller.error(new Error('Render failed'))
							},
						}),
						{ prependDoctype },
					),
				/Render failed/,
			)
			await assert.rejects(
				() =>
					openDocumentStream(
						new ReadableStream({
							start(controller) {
								controller.close()
							},
						}),
						{ prependDoctype },
					),
				/SSR render produced no document/,
			)
		}
	})

	it('does not treat a zero-length chunk as a successfully opened document', async () => {
		let chunks = 0
		await assert.rejects(
			() =>
				openDocumentStream(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							if (chunks++ === 0) controller.enqueue(new Uint8Array())
							else
								controller.error(
									new Error('Render failed after an empty chunk'),
								)
						},
					}),
					{ prependDoctype: false },
				),
			/Render failed after an empty chunk/,
		)
	})
	it('cancels the renderer when a client disconnects', async () => {
		let cancelled: unknown
		const stream = await openDocumentStream(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('<!DOCTYPE html>'))
				},
				cancel(reason) {
					cancelled = reason
				},
			}),
			{ prependDoctype: false },
		)
		await stream.cancel('client disconnected')
		assert.equal(cancelled, 'client disconnected')
	})
})
