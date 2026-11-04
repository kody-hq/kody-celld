import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import type { GatewayEvent } from '../cells/user-cell.ts'
import type { Env } from '../env.ts'
import { startTestMcpServer } from '../mcp-client/test-server.ts'

const workerModule = `export class WorkerEntrypoint {
	constructor(ctx, env) { this.ctx = ctx; this.env = env }
}
export class DurableObject {}`
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		return specifier === 'cloudflare:workers'
			? { url: `data:text/javascript,${encodeURIComponent(workerModule)}`, shortCircuit: true }
			: nextResolve(specifier, context)
	},
})
const { FetchGateway } = await import('../secrets/fetch-gateway.ts')
const { RuntimeHost } = await import('./runtime-host.ts')
hooks.deregister()

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

for (const outcome of ['forwarded', 'injected', 'denied', 'error'] as const) {
	test(`${outcome} fetch waits for its gateway event before returning`, async (t) => {
		const started = deferred()
		const committed = deferred()
		const events: Array<GatewayEvent> = []
		const userCell = {
			async runRecordGatewayEvent(input: { runId: string; event: GatewayEvent }) {
				assert.equal(input.runId, 'fixture-run')
				started.resolve()
				await committed.promise
				events.push(input.event)
			},
			async secretHostList() {
				return [{ host: 'upstream.example.test' }]
			},
			async secretResolveValues() {
				return { values: { fixture: 'fixture-only' }, missing: [], locked: [] }
			},
		}
		const env = {
			KODY_PUBLIC_URL: 'https://cell.example.test',
			USER: { getByName: () => userCell },
		} as unknown as Env
		const ctx = {
			props: { userId: 'fixture-user', packageName: null },
			waitUntil(promise: Promise<unknown>) {
				void promise.catch(() => {})
			},
		} as unknown as ExecutionContext
		const forwarded = t.mock.method(globalThis, 'fetch', async () => {
			if (outcome === 'error') throw new TypeError('fixture network failure')
			return new Response('ok')
		})
		const gateway = new FetchGateway(ctx, env)
		const url = outcome === 'denied' ? 'https://cell.example.test/admin/users' : 'https://upstream.example.test/data'
		const headers = new Headers({ 'x-kody-run': 'fixture-run' })
		if (outcome === 'injected' || outcome === 'error')
			headers.set('authorization', '{'.repeat(2) + 'secret:fixture' + '}'.repeat(2))
		let settled = false
		const pending = gateway.fetch(new Request(url, { headers })).then(
			(response) => {
				settled = true
				return response
			},
			(error: Error) => {
				settled = true
				return error
			},
		)
		try {
			await started.promise
			await setImmediate()
			assert.equal(settled, false, 'the response must not overtake its event write')
			assert.equal(events.length, 0)
		} finally {
			committed.resolve()
			await pending
		}
		const result = await pending
		if (outcome === 'error') {
			assert(result instanceof TypeError)
			assert.equal(result.message, 'fixture network failure')
		} else {
			assert(result instanceof Response)
			assert.equal(result.status, outcome === 'denied' ? 403 : 200)
		}
		assert.equal(events.length, 1)
		assert.equal(events[0]?.outcome, outcome)
		assert.equal(forwarded.mock.callCount(), outcome === 'denied' ? 0 : 1)
		assert.equal(JSON.stringify(events).includes('fixture-only'), false)
	})
}

for (const outcome of ['forwarded', 'denied'] as const) {
	test(`${outcome} MCP call waits for its gateway event before settling`, async (t) => {
		const started = deferred()
		const committed = deferred()
		const events: Array<GatewayEvent> = []
		const server = startTestMcpServer({
			tools: [{ name: 'fixture_echo', handler: () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }) }],
		})
		t.mock.method(globalThis, 'fetch', server.fetch)
		const userCell = {
			async mcpServerGet() {
				return outcome === 'denied'
					? null
					: {
							name: 'fixture',
							url: 'https://tools.example.com/mcp',
							enabled: true,
							usage: { mode: 'any' },
							auth: { kind: 'none' },
							tools: [{ name: 'fixture_echo' }],
						}
			},
			async mcpServerAuthorization() {
				return null
			},
			async runRecordGatewayEvent(input: { runId: string; event: GatewayEvent }) {
				assert.equal(input.runId, 'fixture-run')
				started.resolve()
				await committed.promise
				events.push(input.event)
			},
		}
		const env = {
			KODY_PUBLIC_URL: 'https://cell.example.test',
			USER: { getByName: () => userCell },
		} as unknown as Env
		const ctx = {
			props: { userId: 'fixture-user', email: 'fixture@example.invalid', packageName: null },
			waitUntil(promise: Promise<unknown>) {
				void promise.catch(() => {})
			},
		} as unknown as ExecutionContext
		const host = new RuntimeHost(ctx, env)
		let settled = false
		const pending = host.mcpCall('fixture', 'fixture_echo', {}, { runId: 'fixture-run' }).then(
			(result) => {
				settled = true
				return result
			},
			(error: Error) => {
				settled = true
				return error
			},
		)
		try {
			await started.promise
			await setImmediate()
			assert.equal(settled, false, 'the RPC must not overtake its event write')
			assert.equal(events.length, 0)
		} finally {
			committed.resolve()
			await pending
		}
		assert.equal(events.length, 1)
		assert.equal(events[0]?.outcome, outcome)
		const result = await pending
		if (outcome === 'denied') {
			assert(result instanceof Error)
			assert.match(result.message, /^mcp_server_not_found:/)
		} else {
			assert(!(result instanceof Error))
			assert.deepEqual(result.content, [{ type: 'text', text: 'ok' }])
		}
	})
}
