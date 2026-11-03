export type AppFailure = { name: string; message: string }

/**
 * Streams a package app's response body to the browser under the request's
 * deadline and the byte cap. Past either, the stream errors (the browser sees a
 * cut-off response), the app's body is cancelled and `onFailure` runs once. A
 * browser that goes away cancels the app's body and records nothing.
 */
export function guardAppBody(
	body: ReadableStream<Uint8Array>,
	options: {
		/** Epoch ms by which the whole body must have been sent. */
		deadlineAt: number
		/** The configured timeout, for the message. */
		timeoutMs: number
		maxBytes: number
		onFailure: (error: AppFailure) => void
	},
): ReadableStream<Uint8Array> {
	const reader = body.getReader()
	let bytes = 0
	let settled = false
	let timer: ReturnType<typeof setTimeout> | undefined
	const settle = () => {
		settled = true
		clearTimeout(timer)
	}
	const fail = (controller: ReadableStreamDefaultController<Uint8Array>, error: AppFailure) => {
		if (settled) return
		settle()
		options.onFailure(error)
		controller.error(new Error(error.message))
		reader.cancel(error.message).catch(() => {})
	}
	return new ReadableStream<Uint8Array>({
		start(controller) {
			timer = setTimeout(
				() =>
					fail(controller, {
						name: 'app_timeout',
						message: `The app did not finish its response within ${options.timeoutMs / 1000}s.`,
					}),
				Math.max(0, options.deadlineAt - Date.now()),
			)
		},
		async pull(controller) {
			let result: ReadableStreamReadResult<Uint8Array>
			try {
				result = await reader.read()
			} catch (error) {
				fail(controller, {
					name: 'app_stream_error',
					message: error instanceof Error ? error.message : String(error),
				})
				return
			}
			if (settled) return
			if (result.done) {
				settle()
				controller.close()
				return
			}
			bytes += result.value.byteLength
			if (bytes > options.maxBytes) {
				fail(controller, {
					name: 'app_response_too_large',
					message: `The app response is more than ${options.maxBytes} bytes (KODY_APP_RESPONSE_MAX_BYTES).`,
				})
				return
			}
			controller.enqueue(result.value)
		},
		cancel(reason) {
			settle()
			return reader.cancel(reason)
		},
	})
}
