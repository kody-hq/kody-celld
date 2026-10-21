import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { claRerunEventOrder, pickClaRerunCandidate, shouldRunClaCheckJob } from './cla-workflow-events.ts'

const base = 'kody-hq/kody-celld'
const fork = 'dangh/kody-celld'

describe('shouldRunClaCheckJob', () => {
	it('runs pull_request_target only for fork PRs (write token path)', () => {
		assert.equal(
			shouldRunClaCheckJob({
				eventName: 'pull_request_target',
				headRepoFullName: fork,
				baseRepoFullName: base,
			}),
			true,
		)
		assert.equal(
			shouldRunClaCheckJob({
				eventName: 'pull_request',
				headRepoFullName: fork,
				baseRepoFullName: base,
			}),
			false,
		)
	})

	it('runs pull_request only for same-repo PRs (interim until cleanup)', () => {
		assert.equal(
			shouldRunClaCheckJob({
				eventName: 'pull_request',
				headRepoFullName: base,
				baseRepoFullName: base,
			}),
			true,
		)
		assert.equal(
			shouldRunClaCheckJob({
				eventName: 'pull_request_target',
				headRepoFullName: base,
				baseRepoFullName: base,
			}),
			false,
		)
	})

	it('never double-runs the same PR across both events', () => {
		for (const head of [base, fork]) {
			const runs = (['pull_request', 'pull_request_target'] as const).filter((eventName) =>
				shouldRunClaCheckJob({
					eventName,
					headRepoFullName: head,
					baseRepoFullName: base,
				}),
			)
			assert.equal(runs.length, 1, `expected one event for ${head}, got ${runs.join(',')}`)
		}
	})
})

describe('cla post-sign re-run selection', () => {
	it('prefers the event whose cla job actually ran', () => {
		assert.deepEqual(claRerunEventOrder({ headRepoFullName: fork, baseRepoFullName: base }), [
			'pull_request_target',
			'pull_request',
		])
		assert.deepEqual(claRerunEventOrder({ headRepoFullName: base, baseRepoFullName: base }), [
			'pull_request',
			'pull_request_target',
		])
	})

	it('skips skipped workflow runs so same-repo does not re-trigger a no-op', () => {
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
					event: 'pull_request',
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
