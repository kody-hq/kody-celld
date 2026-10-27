import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityContext } from './define.ts'
import { packageWorkflowCreate, workflowRunCancel, workflowRunList } from './workflows.ts'

const record = {
	id: 'dynwf-id',
	sourceType: 'inline' as const,
	packageId: null,
	workflowName: 'inline-code',
	exportName: null,
	code: 'export default () => 1',
	paramsJson: '{}',
	idempotencyKey: 'key',
	runAt: '2030-01-01T00:00:00.000Z',
	status: 'queued' as const,
	attempts: 0,
	lastError: null,
	createdAt: '2029-12-31T00:00:00.000Z',
	updatedAt: '2029-12-31T00:00:00.000Z',
	completedAt: null,
}

function context(userCell: Record<string, (...args: Array<never>) => unknown> = {}) {
	return {
		user: { id: 'user-1' },
		packageName: null,
		userCell: {
			packageGet: () => ({}),
			workflowCreate: () => record,
			workflowsList: () => [record],
			workflowCancel: () => ({ workflow: record, cancelled: true, alreadyTerminal: false }),
			...userCell,
		},
	} as unknown as CapabilityContext
}

test('workflow create is idempotent and rejects unsupported source revisions', async () => {
	const ids: Array<string> = []
	const ctx = context({
		workflowCreate: ((input: { id: string }) => {
			ids.push(input.id)
			return { ...record, id: input.id }
		}) as never,
	})
	const input = { code: record.code!, idempotencyKey: 'one', params: { count: 1 } }
	const first = (await packageWorkflowCreate.handler(input, ctx)) as { id: string }
	const second = (await packageWorkflowCreate.handler(input, ctx)) as { id: string }
	assert.equal(first.id, second.id)
	assert.deepEqual(ids, [first.id, second.id])
	assert.match(first.id, /^dynwf-/)
	await assert.rejects(packageWorkflowCreate.handler({ exportName: './run', sourceRevision: 'pinned' }, context()), {
		code: 'source_revision_unsupported',
	})
	await assert.rejects(
		packageWorkflowCreate.handler({ code: 'export default 1', sourceRevision: 'latest' }, context()),
		{ code: 'invalid_args' },
	)
	await assert.rejects(packageWorkflowCreate.handler({ code: 'x', exportName: './x' }, context()), {
		code: 'invalid_args',
	})
	await assert.rejects(
		packageWorkflowCreate.handler({ code: 'export default 1', idempotencyKey: 1 } as never, context()),
		{ code: 'invalid_args' },
	)
})

test('workflow create rejects a missing package before writing a workflow', async () => {
	const created: Array<unknown> = []
	const ctx = context({
		packageGet: () => null,
		workflowCreate: ((input: unknown) => {
			created.push(input)
			return record
		}) as never,
	})
	await assert.rejects(packageWorkflowCreate.handler({ exportName: './run', packageId: 'missing' }, ctx), {
		code: 'package_not_found',
		status: 404,
	})
	assert.deepEqual(created, [])
})

test('workflow list returns rows and cancel uses hosted result keys', async () => {
	const listed = (await workflowRunList.handler({}, context())) as {
		workflows: Array<Record<string, unknown>>
	}
	const firstWorkflow = listed.workflows[0]
	assert.ok(firstWorkflow)
	assert.equal(firstWorkflow.id, record.id)
	assert.equal(firstWorkflow.source_type, 'inline')
	assert.equal('workflowName' in firstWorkflow, false)
	const cancelled = (await workflowRunCancel.handler({ id: record.id }, context())) as {
		id: string
		cancelled: boolean
		already_terminal: boolean
		status: string
		message: string
	}
	assert.deepEqual(Object.keys(cancelled), ['id', 'cancelled', 'already_terminal', 'status', 'message'])
	assert.equal(cancelled.cancelled, true)
	await assert.rejects(workflowRunList.handler({ limit: 101 }, context()), { code: 'invalid_args' })
})
