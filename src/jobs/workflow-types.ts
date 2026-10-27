import { backgroundExecutorTimeoutMs } from '../lib/limits.ts'

export type WorkflowStatus = 'queued' | 'running' | 'complete' | 'errored' | 'cancelled'
export type WorkflowSourceType = 'package' | 'inline'

export type WorkflowRecord = {
	id: string
	sourceType: WorkflowSourceType
	packageId: string | null
	workflowName: string
	exportName: string | null
	code: string | null
	paramsJson: string
	idempotencyKey: string | null
	runAt: string
	status: WorkflowStatus
	attempts: number
	lastError: string | null
	createdAt: string
	updatedAt: string
	completedAt: string | null
}

export const workflowAttemptLimit = 4
export const workflowRetryDelayMs = 30_000
export const workflowAttemptStaleAfterMs = backgroundExecutorTimeoutMs + 5 * 60_000
export const workflowAttemptLostError = 'workflow_attempt_lost: the attempt did not report back.'

export async function workflowRunId(
	sourceType: WorkflowSourceType,
	userId: string,
	sourceIdentity: string,
	idempotencyKey: string | null,
) {
	const bytes =
		idempotencyKey === null
			? crypto.getRandomValues(new Uint8Array(32))
			: new Uint8Array(
					await crypto.subtle.digest(
						'SHA-256',
						new TextEncoder().encode(JSON.stringify([userId, sourceType, sourceIdentity, idempotencyKey])),
					),
				)
	const digest = btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '')
	return `${sourceType === 'package' ? 'pkgwf' : 'dynwf'}-${digest}`
}

export function workflowFailureState(input: { attempts: number; now: string; error: string }) {
	if (input.attempts < workflowAttemptLimit) {
		const retryAt = Date.parse(input.now) + workflowRetryDelayMs * 2 ** (input.attempts - 1)
		return {
			status: 'queued' as const,
			runAt: new Date(retryAt).toISOString(),
			completedAt: null,
			lastError: input.error,
		}
	}
	return {
		status: 'errored' as const,
		runAt: input.now,
		completedAt: input.now,
		lastError: input.error,
	}
}

export function workflowLostAttemptFailureState(workflow: WorkflowRecord, now: string) {
	if (workflow.status !== 'running') return null
	const updatedAt = Date.parse(workflow.updatedAt)
	const nowMs = Date.parse(now)
	if (!Number.isFinite(updatedAt) || !Number.isFinite(nowMs) || nowMs - updatedAt <= workflowAttemptStaleAfterMs) {
		return null
	}
	const failedAt = new Date(updatedAt + workflowAttemptStaleAfterMs).toISOString()
	return workflowFailureState({
		attempts: workflow.attempts,
		now: failedAt,
		error: workflowAttemptLostError,
	})
}

export function workflowAttemptFinishState(input: {
	status: WorkflowStatus
	attempts: number
	attempt: number
	ok: boolean
	error: string | null
	now: string
}) {
	if (input.status !== 'running' || input.attempts !== input.attempt) return null
	if (input.ok) {
		return {
			status: 'complete' as const,
			completedAt: input.now,
			lastError: null,
		}
	}
	return workflowFailureState({
		attempts: input.attempts,
		now: input.now,
		error: input.error ?? 'Workflow attempt failed.',
	})
}

export function workflowIsTerminal(status: WorkflowStatus) {
	return status === 'complete' || status === 'errored' || status === 'cancelled'
}

export function workflowClaimableRows(rows: Array<WorkflowRecord>, now: string, limit: number) {
	return rows
		.filter((row) => row.status === 'queued' && row.runAt <= now)
		.sort(
			(a, b) => a.runAt.localeCompare(b.runAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
		)
		.slice(0, limit)
}

export function workflowCancelState(status: WorkflowStatus) {
	return workflowIsTerminal(status)
		? { cancelled: false, alreadyTerminal: true }
		: { cancelled: true, alreadyTerminal: false }
}

export function workflowCreateResult(row: WorkflowRecord) {
	return {
		ok: true as const,
		id: row.id,
		workflow_name: row.workflowName,
		source_type: row.sourceType,
		package_id: row.packageId,
		export_name: row.exportName,
		run_at: row.runAt,
		plan_date: null,
		enqueued_commit: null,
		source_revision: row.sourceType === 'package' ? ('latest' as const) : null,
		status: row.status,
	}
}

export function workflowRunView(row: WorkflowRecord) {
	return {
		id: row.id,
		source_type: row.sourceType,
		package_id: row.packageId,
		kody_id: null,
		source_id: null,
		workflow_name: row.workflowName,
		export_name: row.exportName,
		idempotency_key: row.idempotencyKey,
		run_at: row.runAt,
		plan_date: null,
		status: row.status,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
		completed_at: row.completedAt,
		last_error: row.lastError,
		enqueued_commit: null,
		source_revision: row.sourceType === 'package' ? ('latest' as const) : null,
	}
}
