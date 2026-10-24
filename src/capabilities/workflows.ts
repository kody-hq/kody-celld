import { KodyError } from '../lib/errors.ts'
import { maxConcurrentWorkflows } from '../lib/limits.ts'
import { workflowCreateResult, workflowRunId, workflowRunView } from '../jobs/workflow-types.ts'
import { defineCapability } from './define.ts'

type WorkflowInput = {
	code?: string
	exportName?: string
	packageId?: string
	workflowName?: string
	runAt?: string
	idempotencyKey?: string
	params?: Record<string, unknown>
	sourceRevision?: string
}

function invalid(message: string): never {
	throw new KodyError('invalid_args', message, { status: 400 })
}

export const packageWorkflowCreate = defineCapability<WorkflowInput>({
	domain: 'jobs',
	name: 'packageWorkflowCreate',
	description: 'Queue durable inline code or a saved package export for background execution.',
	tags: ['workflow', 'write'],
	keywords: ['workflow', 'background', 'durable', 'retry', 'schedule'],
	inputSchema: {
		type: 'object',
		properties: {
			code: { type: 'string' },
			exportName: { type: 'string' },
			packageId: { type: 'string' },
			workflowName: { type: 'string' },
			runAt: { type: 'string', description: 'ISO date-time. Defaults to now.' },
			idempotencyKey: { type: 'string' },
			params: { type: 'object' },
			sourceRevision: { type: 'string', enum: ['latest', 'pinned'] },
		},
	},
	async handler(args, ctx) {
		if (args.code !== undefined && typeof args.code !== 'string') invalid('code must be a string.')
		if (args.exportName !== undefined && typeof args.exportName !== 'string') invalid('exportName must be a string.')
		const inline = typeof args.code === 'string'
		const packaged = typeof args.exportName === 'string'
		if (inline === packaged) invalid('Provide exactly one of code or exportName.')
		if (inline && !args.code?.trim()) invalid('code must be a non-empty ESM module.')
		if (packaged && !args.exportName?.trim()) invalid('exportName must be a non-empty string.')
		if (args.sourceRevision !== undefined) {
			if (inline) invalid('sourceRevision is only available for package exports.')
			if (args.sourceRevision !== 'latest' && args.sourceRevision !== 'pinned') {
				invalid('sourceRevision must be "latest" or "pinned".')
			}
			if (args.sourceRevision === 'pinned') {
				throw new KodyError('source_revision_unsupported', 'Pinned package revisions are not available on celld.')
			}
		}
		if (inline && args.packageId !== undefined) invalid('packageId is only available with exportName.')
		if (args.packageId !== undefined && typeof args.packageId !== 'string') invalid('packageId must be a string.')
		const packageId = packaged ? (args.packageId ?? ctx.packageName ?? undefined) : undefined
		if (packaged && !packageId) invalid('packageId is required for exportName outside a package run.')
		if (packageId !== undefined && !packageId.trim()) invalid('packageId must be a non-empty string.')
		if (packaged) {
			const savedPackage = await ctx.userCell.packageGet(packageId!)
			if (!savedPackage) {
				throw new KodyError('package_not_found', `Package "${packageId}" was not found.`, { status: 404 })
			}
		}
		const workflowName = args.workflowName ?? (inline ? 'inline-code' : args.exportName!)
		if (typeof workflowName !== 'string' || !workflowName.trim()) invalid('workflowName must be a non-empty string.')
		const runAt = args.runAt === undefined ? new Date().toISOString() : args.runAt
		if (typeof runAt !== 'string' || !Number.isFinite(Date.parse(runAt)))
			invalid('runAt must be an ISO date-time string.')
		const params = args.params ?? {}
		if (typeof params !== 'object' || params === null || Array.isArray(params)) invalid('params must be a JSON object.')
		let paramsJson: string
		try {
			const serialized = JSON.stringify(params)
			if (serialized === undefined) return invalid('params must be JSON serializable.')
			paramsJson = serialized
		} catch {
			return invalid('params must be JSON serializable.')
		}
		const sourceType = inline ? 'inline' : 'package'
		const exportName = packaged ? args.exportName!.trim() : null
		const sourceIdentity = JSON.stringify([inline ? args.code : packageId, exportName])
		if (args.idempotencyKey !== undefined && typeof args.idempotencyKey !== 'string') {
			invalid('idempotencyKey must be a string.')
		}
		const idempotencyKey = args.idempotencyKey ?? null
		if (idempotencyKey !== null && (!idempotencyKey.trim() || idempotencyKey.length > 200)) {
			invalid('idempotencyKey must be 1 to 200 characters.')
		}
		const id = await workflowRunId(sourceType, ctx.user.id, sourceIdentity, idempotencyKey)
		const row = await ctx.userCell.workflowCreate({
			id,
			sourceType,
			packageId: packageId ?? null,
			workflowName: workflowName.trim(),
			exportName,
			code: inline ? args.code! : null,
			paramsJson,
			idempotencyKey,
			runAt: new Date(runAt).toISOString(),
			maxConcurrent: maxConcurrentWorkflows,
		})
		return workflowCreateResult(row)
	},
})

export const workflowRunList = defineCapability<{ limit?: number }>({
	domain: 'jobs',
	name: 'workflowRunList',
	description: 'List recent durable workflow runs and their statuses.',
	tags: ['workflow', 'read'],
	keywords: ['workflow', 'list', 'status', 'background'],
	inputSchema: {
		type: 'object',
		properties: { limit: { type: 'integer', description: 'Maximum rows, from 1 to 100. Defaults to 25.' } },
	},
	readOnly: true,
	async handler(args, ctx) {
		const limit = args.limit ?? 25
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('limit must be 1 to 100.')
		return { workflows: (await ctx.userCell.workflowsList(limit)).map(workflowRunView) }
	},
})

export const workflowRunCancel = defineCapability<{ id: string }>({
	domain: 'jobs',
	name: 'workflowRunCancel',
	description:
		'Cancel a queued or running workflow. A running attempt is not interrupted, but its result is discarded.',
	tags: ['workflow', 'write'],
	keywords: ['workflow', 'cancel', 'stop', 'background'],
	inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
	async handler(args, ctx) {
		if (typeof args.id !== 'string' || !args.id.trim()) invalid('id must be a non-empty string.')
		const result = await ctx.userCell.workflowCancel(args.id)
		if (!result) throw new KodyError('workflow_not_found', `Workflow "${args.id}" was not found.`, { status: 404 })
		return {
			id: result.workflow.id,
			cancelled: result.cancelled,
			already_terminal: result.alreadyTerminal,
			status: result.workflow.status,
			message: result.cancelled
				? 'Workflow run cancelled.'
				: `Workflow run already finished with status "${result.workflow.status}"; cancellation is a no-op.`,
		}
	},
})

export const workflowCapabilities = [packageWorkflowCreate, workflowRunList, workflowRunCancel]
