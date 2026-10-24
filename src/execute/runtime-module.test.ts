import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RUNTIME_MODULE_SOURCE } from './runtime-module.ts'

describe('runtime module events', () => {
	it('dispatches through the host with package context and event depth', async () => {
		const calls: Array<{ name: string; args: unknown; context: unknown }> = []
		const runtime = await import(`data:text/javascript;base64,${Buffer.from(RUNTIME_MODULE_SOURCE).toString('base64')}`)
		runtime.__init({
			KODY: {
				capability: async (name: string, args: unknown, context: unknown) => {
					calls.push({ name, args, context })
					return { status: 'delivered_inline' }
				},
			},
		})
		const input = { topic: '@scope/task.created', idempotencyKey: 'task:1', payload: { id: 'task-1' } }
		const result = await runtime.__run({ runId: 'run-1', packageName: '@scope/source', eventDepth: 3 }, () =>
			runtime.events.dispatch(input),
		)
		assert.deepEqual(result, { status: 'delivered_inline' })
		assert.deepEqual(calls, [
			{
				name: 'packageEventDispatch',
				args: input,
				context: { runId: 'run-1', packageName: '@scope/source', eventDepth: 3 },
			},
		])
	})
})
