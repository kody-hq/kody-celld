import type { JobRecord } from '../cells/user-cell.ts'
import type { WorkflowRecord } from './workflow-types.ts'
import type { Env } from '../env.ts'
import { executeRun, getUserCell } from '../execute/engine.ts'
import { backgroundExecutorTimeoutMs, maxConcurrentWorkflows } from '../lib/limits.ts'

export type JobUser = { id: string; email: string }

/**
 * Runs one job with package provenance and records a job_run row. The
 * schedule itself was already advanced by `jobsClaimDue` (or is untouched for
 * manual triggers), so a crashed run never re-fires the same slot.
 */
export async function runJobNow(
	env: Env,
	exports: ExecutionContext['exports'],
	user: JobUser,
	job: JobRecord,
	trigger: 'cron' | 'manual',
	scheduledFor: string = new Date().toISOString(),
) {
	const userCell = getUserCell(env, user.id)
	const jobRunId = await userCell.jobRunStart({ jobId: job.id, trigger })
	const result = await executeRun(env, exports, {
		kind: 'job',
		user,
		entry: { kind: 'package', packageName: job.packageName, entryPath: job.entry },
		params: { jobName: job.jobName, packageName: job.packageName, scheduledFor, trigger, jobId: job.id },
		trigger,
		jobId: job.id,
	})
	await userCell.jobRunFinish({
		id: jobRunId,
		jobId: job.id,
		status: result.ok ? 'success' : 'error',
		resultJson: result.result === undefined ? null : JSON.stringify(result.result),
		error: result.error ? `${result.error.name}: ${result.error.message}` : null,
		logsJson: JSON.stringify(result.logs),
	})
	return { jobRunId, runId: result.runId, ok: result.ok, result: result.result, error: result.error, logs: result.logs }
}

/** Cron entry point: claims and runs every due job for every user. */
export async function dispatchDueJobs(env: Env, exports: ExecutionContext['exports'], now = new Date()) {
	const registry = env.REGISTRY.getByName('registry')
	const users = await registry.listUsers()
	const nowIso = now.toISOString()
	const summary: Array<{ userId: string; jobId: string; ok: boolean; runId: string }> = []
	await Promise.all(
		users.map(async (user) => {
			const due = await getUserCell(env, user.id).jobsClaimDue(nowIso)
			for (const job of due) {
				const outcome = await runJobNow(env, exports, user, job, 'cron', job.nextRunAt ?? nowIso)
				summary.push({ userId: user.id, jobId: job.id, ok: outcome.ok, runId: outcome.runId })
			}
		}),
	)
	return { at: nowIso, users: users.length, ran: summary }
}

async function runWorkflowAttempt(
	env: Env,
	exports: ExecutionContext['exports'],
	user: JobUser,
	workflow: WorkflowRecord,
) {
	const userCell = getUserCell(env, user.id)
	let ok = false
	let runId: string | null = null
	let error: string | null = null
	try {
		const result = await executeRun(env, exports, {
			kind: 'workflow',
			user,
			entry:
				workflow.sourceType === 'package'
					? { kind: 'package', packageName: workflow.packageId!, exportName: workflow.exportName! }
					: { kind: 'adhoc', code: workflow.code! },
			params: JSON.parse(workflow.paramsJson) as unknown,
			trigger: 'workflow',
			timeoutMs: backgroundExecutorTimeoutMs,
		})
		runId = result.runId
		ok = result.ok
		if (!result.ok) error = result.error ? `${result.error.name}: ${result.error.message}` : 'Workflow attempt failed.'
	} catch (cause) {
		error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
	}
	const updated = userCell.workflowAttemptFinish({
		id: workflow.id,
		attempt: workflow.attempts,
		ok,
		error,
		now: new Date().toISOString(),
	})
	const finalized = await updated
	return { workflowId: workflow.id, status: finalized?.status ?? 'missing', runId }
}

export async function dispatchDueWorkflows(env: Env, exports: ExecutionContext['exports'], now = new Date()) {
	const registry = env.REGISTRY.getByName('registry')
	const users = await registry.listUsers()
	const nowIso = now.toISOString()
	const summary: Array<{ userId: string; workflowId: string; status: string; runId: string | null }> = []
	await Promise.all(
		users.map(async (user) => {
			const userCell = getUserCell(env, user.id)
			const workflows = await userCell.workflowsClaimDue(nowIso, maxConcurrentWorkflows)
			const outcomes = await Promise.all(workflows.map((workflow) => runWorkflowAttempt(env, exports, user, workflow)))
			for (const outcome of outcomes) summary.push({ userId: user.id, ...outcome })
		}),
	)
	return { at: nowIso, users: users.length, ran: summary }
}
