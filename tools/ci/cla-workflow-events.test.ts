import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldRunClaCheckJob } from './cla-workflow-events.ts'

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
