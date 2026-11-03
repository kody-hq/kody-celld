import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PendingAppGateway } from './pending-gateway.ts'

const event = (n: number) => ({ n })

describe('PendingAppGateway', () => {
	it('holds events for app request ids until the failure run takes them', () => {
		const pending = new PendingAppGateway<{ n: number }>()
		assert.equal(pending.hold('app_1', event(1)), true)
		assert.equal(pending.hold('app_1', event(2)), true)
		assert.deepEqual(pending.take('app_1'), [event(1), event(2)])
		assert.deepEqual(pending.take('app_1'), [], 'taken once')
	})

	it('ignores ids that are not app request ids', () => {
		const pending = new PendingAppGateway<{ n: number }>()
		assert.equal(pending.hold('run_1', event(1)), false)
		assert.deepEqual(pending.take('run_1'), [])
	})

	it('keeps the newest events per request and the newest requests', () => {
		const pending = new PendingAppGateway<{ n: number }>({ maxRuns: 2, maxEvents: 2 })
		for (const n of [1, 2, 3]) pending.hold('app_a', event(n))
		pending.hold('app_b', event(1))
		pending.hold('app_c', event(1))
		assert.deepEqual(pending.take('app_a'), [], 'oldest request dropped')
		assert.deepEqual(pending.take('app_b'), [event(1)])
		assert.deepEqual(pending.take('app_c'), [event(1)])
	})

	it('drops held events after the ttl', () => {
		let now = 0
		const pending = new PendingAppGateway<{ n: number }>({ ttlMs: 1000, now: () => now })
		pending.hold('app_1', event(1))
		now = 1001
		assert.deepEqual(pending.take('app_1'), [])
	})
})
