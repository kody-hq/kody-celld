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
				context: { runId: 'run-1', packageName: '@scope/source', eventDepth: 3, computedImportDepth: 0 },
			},
		])
	})

	it('installs a computed package import bridge with the current call context', async () => {
		const key = Symbol.for('kody.computedPackageImport')
		const previous = Reflect.get(globalThis, key)
		const calls: Array<{ name: string; args: unknown; context: unknown }> = []
		try {
			const runtime = await import(
				`data:text/javascript;base64,${Buffer.from(RUNTIME_MODULE_SOURCE).toString('base64')}`
			)
			const initialize = Reflect.get(runtime, '__init') as (env: unknown) => void
			const run = Reflect.get(runtime, '__run') as (
				context: Record<string, unknown>,
				callback: () => Promise<unknown>,
			) => Promise<unknown>
			initialize({
				KODY: {
					capability: async (name: string, args: unknown, context: unknown) => {
						calls.push({ name, args, context })
						return 4
					},
				},
			})
			const bridge = Reflect.get(globalThis, key) as (input: unknown) => Promise<unknown>
			const input = { specifier: 'kody:@scope/pkg/compute', params: { n: 2 } }
			const result = await run(
				{
					runId: 'run-1',
					packageName: '@scope/source',
					eventDepth: 2,
					computedImportDepth: 3,
					timeoutMs: 1200,
				},
				() => bridge(input),
			)
			assert.equal(result, 4)
			assert.deepEqual(calls, [
				{
					name: 'packageComputedImport',
					args: input,
					context: {
						runId: 'run-1',
						packageName: '@scope/source',
						eventDepth: 2,
						computedImportDepth: 3,
						timeoutMs: 1200,
					},
				},
			])
		} finally {
			if (previous === undefined) Reflect.deleteProperty(globalThis, key)
			else Reflect.set(globalThis, key, previous)
		}
	})
})
