import assert from 'node:assert/strict'
import { it } from 'node:test'
import { RUNTIME_MODULE_SOURCE } from './runtime-module.ts'
import { buildWrapperModule } from './wrapper-module.ts'

const dataUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

it('propagates subscription triggers into the runtime helper context', async () => {
	const runtimeUrl = dataUrl(RUNTIME_MODULE_SOURCE)
	const entryUrl = dataUrl(`
		import { email } from ${JSON.stringify(runtimeUrl)}
		export default async function () {
			return email.getMessage('msg-1')
		}
	`)
	const source = buildWrapperModule(entryUrl).replaceAll(
		"from './kody-runtime.js'",
		`from ${JSON.stringify(runtimeUrl)}`,
	)
	const wrapper = (await import(dataUrl(source))) as {
		default: {
			fetch(request: Request, env: unknown): Promise<Response>
		}
	}
	const originalFetch = globalThis.fetch
	const originalConsole = console
	const calls: Array<Array<unknown>> = []
	try {
		const response = await wrapper.default.fetch(
			new Request('https://celld.invalid/run', {
				method: 'POST',
				body: JSON.stringify({
					params: {},
					context: {
						runId: 'run-1',
						packageName: '@team/mail',
						packageVersion: '1.0.0',
						trigger: 'subscription:email.message.received',
					},
				}),
			}),
			{
				KODY: {
					capability: async (...args: Array<unknown>) => {
						calls.push(args)
						return {
							id: 'msg-1',
							direction: 'inbound',
							inboxAddress: 'inbox@example.test',
							from: { address: 'sender@example.test', name: null },
							to: [],
							cc: [],
							replyTo: [],
							subject: 'Hello',
							messageId: null,
							inReplyTo: null,
							references: [],
							text: 'Body',
							html: null,
							headers: {},
							sizeBytes: 4,
							providerMessageId: null,
							deliveryStatus: null,
							receivedAt: '2026-01-01T00:00:00.000Z',
							createdAt: '2026-01-01T00:00:00.000Z',
							attachments: [],
						}
					},
				},
			},
		)
		const payload = (await response.json()) as { ok: boolean; result: { id: string } }
		assert.equal(payload.ok, true)
		assert.equal(payload.result.id, 'msg-1')
		assert.deepEqual(calls, [
			[
				'emailMessageGet',
				{ id: 'msg-1' },
				{ runId: 'run-1', packageName: '@team/mail', eventDepth: 0, computedImportDepth: 0 },
			],
		])
	} finally {
		globalThis.fetch = originalFetch
		Reflect.set(globalThis, 'console', originalConsole)
	}
})
