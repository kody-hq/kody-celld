import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Regression for manual Run now: cron sets last_run_at in jobsClaimDue, but
 * manual runs only go through jobRunStart/jobRunFinish. Without a last_run_at
 * write on start, the account UI keeps showing "never" next to a successful
 * last status.
 */
const jobsSchema = `
	CREATE TABLE jobs (
		id TEXT PRIMARY KEY,
		last_run_at TEXT,
		last_status TEXT,
		last_error TEXT,
		updated_at TEXT NOT NULL
	);
	CREATE TABLE job_runs (
		id TEXT PRIMARY KEY,
		job_id TEXT NOT NULL,
		trigger TEXT NOT NULL,
		started_at TEXT NOT NULL,
		finished_at TEXT,
		status TEXT NOT NULL,
		result_json TEXT,
		error TEXT,
		logs_json TEXT NOT NULL DEFAULT '[]'
	);
`

function applyJobRunStart(
	db: DatabaseSync,
	input: { id: string; jobId: string; trigger: string; startedAt: string },
) {
	db.prepare(
		`INSERT INTO job_runs (id, job_id, trigger, started_at, status) VALUES (?, ?, ?, ?, 'running')`,
	).run(input.id, input.jobId, input.trigger, input.startedAt)
	db.prepare(
		'UPDATE jobs SET last_run_at = ?, last_status = ?, updated_at = ? WHERE id = ?',
	).run(input.startedAt, 'running', input.startedAt, input.jobId)
}

function applyJobRunFinish(
	db: DatabaseSync,
	input: {
		id: string
		jobId: string
		status: 'success' | 'error'
		finishedAt: string
		error?: string | null
	},
) {
	db.prepare(
		'UPDATE job_runs SET finished_at = ?, status = ?, result_json = ?, error = ?, logs_json = ? WHERE id = ?',
	).run(input.finishedAt, input.status, null, input.error ?? null, '[]', input.id)
	db.prepare(
		'UPDATE jobs SET last_status = ?, last_error = ?, updated_at = ? WHERE id = ?',
	).run(input.status, input.error ?? null, input.finishedAt, input.jobId)
}

describe('job run last_run_at', () => {
	it('jobRunStart in UserCell writes last_run_at (manual path has no jobsClaimDue)', () => {
		const source = readFileSync(
			fileURLToPath(new URL('../cells/user-cell.ts', import.meta.url)),
			'utf8',
		)
		const start = source.indexOf('async jobRunStart')
		const finish = source.indexOf('async jobRunFinish')
		assert.ok(start >= 0 && finish > start, 'jobRunStart/jobRunFinish markers present')
		const body = source.slice(start, finish)
		assert.match(body, /last_run_at = \?/, 'jobRunStart must update last_run_at')
		assert.match(body, /last_status = \?/, 'jobRunStart must update last_status')
		assert.doesNotMatch(
			body,
			/SET[^;]*next_run_at/,
			'jobRunStart must not advance the schedule (manual leaves it alone)',
		)
	})

	it('manual start writes last_run_at so finish leaves a timestamp beside last status', () => {
		const db = new DatabaseSync(':memory:')
		db.exec(jobsSchema)
		db.prepare(
			`INSERT INTO jobs (id, last_run_at, last_status, last_error, updated_at) VALUES (?, NULL, NULL, NULL, ?)`,
		).run('pkg#nightly', '2026-01-01T00:00:00.000Z')

		applyJobRunStart(db, {
			id: 'jobrun_1',
			jobId: 'pkg#nightly',
			trigger: 'manual',
			startedAt: '2026-04-01T12:00:00.000Z',
		})
		let job = db.prepare('SELECT last_run_at, last_status FROM jobs WHERE id = ?').get('pkg#nightly') as {
			last_run_at: string | null
			last_status: string | null
		}
		assert.equal(job.last_run_at, '2026-04-01T12:00:00.000Z')
		assert.equal(job.last_status, 'running')

		applyJobRunFinish(db, {
			id: 'jobrun_1',
			jobId: 'pkg#nightly',
			status: 'success',
			finishedAt: '2026-04-01T12:00:01.000Z',
		})
		job = db.prepare('SELECT last_run_at, last_status, last_error FROM jobs WHERE id = ?').get('pkg#nightly') as {
			last_run_at: string | null
			last_status: string | null
			last_error: string | null
		}
		assert.equal(job.last_run_at, '2026-04-01T12:00:00.000Z', 'finish must not clear last_run_at')
		assert.equal(job.last_status, 'success')
		assert.equal(job.last_error, null)
	})
})
