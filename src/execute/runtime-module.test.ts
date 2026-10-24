import assert from 'node:assert/strict'
import test from 'node:test'
import { RUNTIME_MODULE_SOURCE } from './runtime-module.ts'

test('workflows.create dispatches the packageWorkflowCreate host capability', async () => {
	const calls: Array<unknown> = []
	const source = `data:text/javascript;base64,${Buffer.from(RUNTIME_MODULE_SOURCE).toString('base64')}`
	const runtime = (await import(source)) as {
		__init: (host: unknown) => void
		workflows: { create: (input: unknown) => Promise<unknown> }
	}
	runtime.__init({
		KODY: {
			capability: async (...args: Array<unknown>) => {
				calls.push(args)
				return { ok: true }
			},
		},
	})
	assert.deepEqual(await runtime.workflows.create({ code: 'export default 1' }), { ok: true })
	assert.deepEqual(calls, [['packageWorkflowCreate', { code: 'export default 1' }, expectNoContext()]])
})

function expectNoContext() {
	return null
}
