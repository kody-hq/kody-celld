import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { workflowView } from './workflow-view.ts'

describe('workflowView', () => {
	it('maps a stored workflow to the page view without code or params', () => {
		const view = workflowView({
			id: 'pkgwf-abc',
			sourceType: 'package',
			packageId: 'example-package',
			workflowName: './nightly-sync',
			exportName: './nightly-sync',
			code: null,
			paramsJson: '{"token":"not shown"}',
			idempotencyKey: 'nightly-sync:2026-10-24',
			runAt: '2026-10-24T08:00:00.000Z',
			status: 'queued',
			attempts: 2,
			lastError: 'Error: upstream timeout',
			createdAt: '2026-10-24T07:00:00.000Z',
			updatedAt: '2026-10-24T07:30:00.000Z',
			completedAt: null,
		})
		assert.deepEqual(view, {
			id: 'pkgwf-abc',
			sourceType: 'package',
			packageId: 'example-package',
			workflowName: './nightly-sync',
			exportName: './nightly-sync',
			idempotencyKey: 'nightly-sync:2026-10-24',
			status: 'queued',
			attempts: 2,
			runAt: '2026-10-24T08:00:00.000Z',
			updatedAt: '2026-10-24T07:30:00.000Z',
			lastError: 'Error: upstream timeout',
		})
	})
})
