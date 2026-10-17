// Safety locks for the celld epoch-GC plan we rely on in single mode.
// Source of truth: denoland/celld v0.6.1 crates/logic/epoch_gc.rs `plan`.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planEpochGc } from './epoch-gc-plan.mjs'

const grace = 60_000
const now = 1_000_000

describe('epoch GC plan (celld crates/logic/epoch_gc.rs)', () => {
	it('returns null while paged reads are still pinned to older epochs', () => {
		assert.equal(planEpochGc(5, [3, 5], [{ epoch: 1, newestMs: 0 }], null, true, now, grace), null)
	})

	it('returns null when the chain tip is not this owner epoch', () => {
		assert.equal(planEpochGc(5, [3, 4], [{ epoch: 1, newestMs: 0 }], null, false, now, grace), null)
	})

	it('never deletes the current owner epoch or the epoch immediately before it', () => {
		const plan = planEpochGc(
			10,
			[8, 10],
			[
				{ epoch: 1, newestMs: 0 },
				{ epoch: 7, newestMs: 0 },
				{ epoch: 8, newestMs: 0 },
				{ epoch: 9, newestMs: 0 },
				{ epoch: 10, newestMs: 0 },
			],
			null,
			false,
			now,
			grace,
		)
		assert.ok(plan)
		assert.deepEqual(plan.delete, [1, 7])
		assert.ok(!plan.delete.includes(8), 'base stays')
		assert.ok(!plan.delete.includes(9), 'previous epoch stays')
		assert.ok(!plan.delete.includes(10), 'own epoch stays')
	})

	it('never deletes the restore-chain base or anything at/above it', () => {
		const plan = planEpochGc(
			5,
			[3, 5],
			[
				{ epoch: 1, newestMs: 0 },
				{ epoch: 2, newestMs: 0 },
				{ epoch: 3, newestMs: 0 },
				{ epoch: 4, newestMs: 0 },
			],
			null,
			false,
			now,
			grace,
		)
		assert.ok(plan)
		assert.equal(plan.retiredBelow, 3)
		assert.deepEqual(plan.delete, [1, 2])
		assert.ok(plan.delete.every((epoch) => epoch < 3))
	})

	it('keeps epochs younger than the grace window', () => {
		const plan = planEpochGc(
			5,
			[3, 5],
			[
				{ epoch: 1, newestMs: now - grace - 1 },
				{ epoch: 2, newestMs: now - grace + 1 },
			],
			null,
			false,
			now,
			grace,
		)
		assert.ok(plan)
		assert.deepEqual(plan.delete, [1])
	})

	it('decides nothing when a recorded mark is above the current base', () => {
		assert.equal(planEpochGc(5, [3, 5], [{ epoch: 1, newestMs: 0 }], 4, false, now, grace), null)
	})
})
