import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
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

	it('keeps the newest 100 events per request and the newest 64 requests', () => {
		const pending = new PendingAppGateway<{ n: number }>()
		for (let n = 1; n <= 101; n++) pending.hold('app_a', event(n))
		const kept = pending.take('app_a')
		assert.equal(kept.length, 100)
		assert.deepEqual(kept[0], event(2))
		for (let id = 0; id <= 64; id++) pending.hold(`app_${id}`, event(id))
		assert.deepEqual(pending.take('app_0'), [], 'oldest request dropped')
		assert.deepEqual(pending.take('app_1'), [event(1)])
		assert.deepEqual(pending.take('app_64'), [event(64)])
	})

	it('drops held events after the ttl', () => {
		mock.timers.enable({ apis: ['Date'] })
		try {
			const pending = new PendingAppGateway<{ n: number }>()
			pending.hold('app_1', event(1))
			mock.timers.tick(16 * 60_000 + 1)
			assert.deepEqual(pending.take('app_1'), [])
		} finally {
			mock.timers.reset()
		}
	})
})
