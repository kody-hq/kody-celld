import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	buildPackageEventEnvelope,
	buildPackageEventSubscriptionIdempotencyKey,
	packageEventFiltersMatchPayload,
} from './package-events.ts'

describe('package event delivery helpers', () => {
	it('matches missing, empty, and nested canonical filters', () => {
		assert.equal(packageEventFiltersMatchPayload({ filters: undefined, payload: {} }), true)
		assert.equal(packageEventFiltersMatchPayload({ filters: { type: 'task' }, payload: {} }), false)
		assert.equal(
			packageEventFiltersMatchPayload({
				filters: { metadata: { z: 2, a: 1 } },
				payload: { metadata: { a: 1, z: 2 } },
			}),
			true,
		)
	})

	it('builds stable per-subscriber keys and uses the long-key fallback', async () => {
		const input = {
			sourcePackageId: '@example/source',
			subscriberPackageId: '@example/subscriber',
			topic: '@example/task.created',
			idempotencyKey: 'task:1',
		}
		const first = await buildPackageEventSubscriptionIdempotencyKey(input)
		assert.equal(first, await buildPackageEventSubscriptionIdempotencyKey(input))
		assert.notEqual(
			first,
			await buildPackageEventSubscriptionIdempotencyKey({ ...input, subscriberPackageId: '@example/other' }),
		)
		const long = await buildPackageEventSubscriptionIdempotencyKey({ ...input, topic: `@example/${'x'.repeat(220)}` })
		assert.match(long, /^pkgevent:[0-9a-f]{64}$/)
	})

	it('builds the snake_case envelope and strips untrusted fields', () => {
		assert.deepEqual(
			buildPackageEventEnvelope({
				topic: '@example/task.created',
				sourcePackageId: '@example/source',
				idempotencyKey: 'task:1',
				payload: { taskId: 'task-1', synthetic: true, replay_of: 'old' },
			}),
			{
				event: '@example/task.created',
				source: { type: 'package', package_id: '@example/source', kody_id: '@example/source' },
				idempotency_key: 'task:1',
				payload: { taskId: 'task-1' },
			},
		)
	})
})
