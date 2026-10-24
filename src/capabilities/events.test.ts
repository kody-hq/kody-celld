import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { packageEventDispatch } from './events.ts'
import type { CapabilityContext } from './define.ts'

const event = { topic: '@example/task.created', description: 'Task created.' }

function context(overrides: Partial<CapabilityContext> = {}) {
	return {
		env: {} as CapabilityContext['env'],
		exports: {} as CapabilityContext['exports'],
		user: { id: 'user-1', email: 'owner@example.test' },
		userCell: {
			packageGet: async () => ({ manifest: { emits: [event] } }),
		},
		packageName: '@example/source',
		runId: 'run-1',
		eventDepth: 0,
		baseUrl: 'http://localhost',
		fromRuntime: true,
		...overrides,
	} as CapabilityContext
}

async function rejects(input: unknown, ctx = context(), code: string) {
	await assert.rejects(packageEventDispatch.handler(input as never, ctx), (error: unknown) => {
		assert.equal((error as { code?: string }).code, code)
		return true
	})
}

describe('events.dispatch', () => {
	it('requires a package runtime context', async () => {
		await rejects({}, context({ fromRuntime: false }), 'events_unavailable')
	})

	it('rejects nested dispatch at the maximum depth', async () => {
		await rejects({}, context({ eventDepth: 8 }), 'event_depth_exceeded')
	})

	it('validates required input and payload shape', async () => {
		await rejects({ topic: '@example/task.created' }, context(), 'invalid_input')
		await rejects({ topic: '@example/task.created', idempotencyKey: '1', payload: [] }, context(), 'invalid_input')
	})

	it('rejects undeclared topics and schema mismatches', async () => {
		await rejects({ topic: '@example/other', idempotencyKey: '1' }, context(), 'event_not_declared')
		await rejects(
			{ topic: event.topic, idempotencyKey: '1', payload: {} },
			context({
				userCell: {
					packageGet: async () => ({
						manifest: {
							emits: [{ ...event, payloadSchema: { type: 'object', required: ['taskId'] } }],
						},
					}),
				} as unknown as CapabilityContext['userCell'],
			}),
			'invalid_input',
		)
	})

	it('rejects oversized payloads', async () => {
		await rejects(
			{ topic: event.topic, idempotencyKey: '1', payload: { value: 'x'.repeat(70_000) } },
			context(),
			'payload_too_large',
		)
	})

	it('returns before subscriber delivery settles when waitUntil is available', async () => {
		let waitUntilCalls = 0
		const ctx = context({
			userCell: {
				packageGet: async () => ({ manifest: { emits: [event] } }),
				subscriptionList: () => new Promise<never>(() => {}),
			} as unknown as CapabilityContext['userCell'],
			waitUntil: () => {
				waitUntilCalls++
			},
		})
		const result = await packageEventDispatch.handler({ topic: event.topic, idempotencyKey: '1' }, ctx)
		assert.equal((result as { status: string }).status, 'delivered_inline')
		assert.equal(waitUntilCalls, 1)
	})
})
