import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { claRerunEventOrder, pickClaRerunCandidate } from './cla-workflow-events.ts'

describe('cla post-sign re-run selection', () => {
	it('looks up only pull_request_target after the interim pull_request trigger was removed', () => {
		assert.deepEqual(claRerunEventOrder(), ['pull_request_target'])
	})

	it('skips skipped workflow runs so a no-op is not re-triggered', () => {
		assert.equal(
			pickClaRerunCandidate([
				{
					id: 1,
					event: 'pull_request_target',
					status: 'completed',
					conclusion: 'skipped',
				},
				{
					id: 2,
					event: 'pull_request_target',
					status: 'completed',
					conclusion: 'failure',
				},
			])?.id,
			2,
		)
		assert.equal(
			pickClaRerunCandidate([
				{
					id: 3,
					event: 'pull_request_target',
					status: 'in_progress',
					conclusion: null,
				},
			])?.id,
			3,
		)
		assert.equal(pickClaRerunCandidate([]), null)
	})
})
