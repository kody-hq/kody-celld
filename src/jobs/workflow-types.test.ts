import assert from 'node:assert/strict'
import test from 'node:test'
import {
	workflowCreateResult,
	workflowClaimableRows,
	workflowCancelState,
	workflowFailureState,
	workflowIsTerminal,
	workflowRunId,
	workflowRunView,
	type WorkflowRecord,
} from './workflow-types.ts'

const workflow: WorkflowRecord = {
	id: 'pkgwf-id',
	sourceType: 'package',
	packageId: '@demo/pkg',
	workflowName: 'reports/daily',
	exportName: './daily',
	code: null,
	paramsJson: '{}',
	idempotencyKey: 'daily-1',
	runAt: '2030-01-01T00:00:00.000Z',
	status: 'queued',
	attempts: 0,
	lastError: null,
	createdAt: '2029-12-31T00:00:00.000Z',
	updatedAt: '2029-12-31T00:00:00.000Z',
	completedAt: null,
}

test('workflow IDs are stable, scoped, and use hosted prefixes', async () => {
	const first = await workflowRunId('package', 'u1', 'source', 'key')
	assert.equal(first, await workflowRunId('package', 'u1', 'source', 'key'))
	assert.match(first, /^pkgwf-[A-Za-z0-9_-]{43}$/)
	assert.notEqual(first, await workflowRunId('package', 'u2', 'source', 'key'))
	assert.match(await workflowRunId('inline', 'u1', 'source', 'key'), /^dynwf-/)
	assert.notEqual(
		await workflowRunId('inline', 'u1', 'source', null),
		await workflowRunId('inline', 'u1', 'source', null),
	)
})

test('workflow failures retry exponentially and stop after four attempts', () => {
	assert.equal(
		workflowFailureState({ attempts: 1, now: '2030-01-01T00:00:00.000Z', error: 'e' }).runAt,
		'2030-01-01T00:00:30.000Z',
	)
	assert.equal(
		workflowFailureState({ attempts: 2, now: '2030-01-01T00:00:00.000Z', error: 'e' }).runAt,
		'2030-01-01T00:01:00.000Z',
	)
	assert.equal(
		workflowFailureState({ attempts: 3, now: '2030-01-01T00:00:00.000Z', error: 'e' }).runAt,
		'2030-01-01T00:02:00.000Z',
	)
	assert.deepEqual(workflowFailureState({ attempts: 4, now: '2030-01-01T00:00:00.000Z', error: 'e' }), {
		status: 'errored',
		runAt: '2030-01-01T00:00:00.000Z',
		completedAt: '2030-01-01T00:00:00.000Z',
		lastError: 'e',
	})
	assert.equal(workflowIsTerminal('cancelled'), true)
	assert.equal(workflowIsTerminal('running'), false)
	assert.deepEqual(workflowCancelState('running'), { cancelled: true, alreadyTerminal: false })
	assert.deepEqual(workflowCancelState('complete'), { cancelled: false, alreadyTerminal: true })
	assert.deepEqual(
		workflowClaimableRows(
			[
				{ ...workflow, id: 'later', runAt: '2030-01-02T00:00:00.000Z' },
				{ ...workflow, id: 'due', runAt: '2030-01-01T00:00:00.000Z' },
			],
			'2030-01-01T12:00:00.000Z',
			1,
		).map((row) => row.id),
		['due'],
	)
})

test('create and list views use hosted field names', () => {
	assert.deepEqual(workflowCreateResult(workflow), {
		ok: true,
		id: 'pkgwf-id',
		workflow_name: 'reports/daily',
		source_type: 'package',
		package_id: '@demo/pkg',
		export_name: './daily',
		run_at: '2030-01-01T00:00:00.000Z',
		plan_date: null,
		enqueued_commit: null,
		source_revision: 'latest',
		status: 'queued',
	})
	assert.deepEqual(workflowRunView(workflow), {
		id: 'pkgwf-id',
		source_type: 'package',
		package_id: '@demo/pkg',
		kody_id: null,
		source_id: null,
		workflow_name: 'reports/daily',
		export_name: './daily',
		idempotency_key: 'daily-1',
		run_at: '2030-01-01T00:00:00.000Z',
		plan_date: null,
		status: 'queued',
		created_at: '2029-12-31T00:00:00.000Z',
		updated_at: '2029-12-31T00:00:00.000Z',
		completed_at: null,
		last_error: null,
		enqueued_commit: null,
		source_revision: 'latest',
	})
})
