import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url).href)

/**
 * Manual Run now must show last-run time and status without writing
 * jobs.last_run_at (that column anchors interval/once rescheduling). The
 * account UI reads lastRunAt/lastStatus/lastError from jobList/jobGet, which
 * take those fields from the same latest job_runs row when it is newer than
 * the schedule-anchor column.
 */
const jobsSchema = `
	CREATE TABLE jobs (
		id TEXT PRIMARY KEY,
		package_name TEXT NOT NULL,
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

type DisplayJob = {
	lastRunAt: string | null
	lastStatus: string | null
	lastError: string | null
}

/** Oracle for withLatestRun: one latest job_runs row drives display fields. */
function displayFromLatestRun(
	db: DatabaseSync,
	jobId: string,
	column: { last_run_at: string | null; last_status: string | null; last_error: string | null },
): DisplayJob {
	const latest = db
		.prepare('SELECT started_at, status, error FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1')
		.get(jobId) as { started_at: string; status: string; error: string | null } | undefined
	if (!latest) {
		return { lastRunAt: column.last_run_at, lastStatus: column.last_status, lastError: column.last_error }
	}
	if (!column.last_run_at || latest.started_at > column.last_run_at) {
		return { lastRunAt: latest.started_at, lastStatus: latest.status, lastError: latest.error }
	}
	return { lastRunAt: column.last_run_at, lastStatus: column.last_status, lastError: column.last_error }
}

function readJobColumns(db: DatabaseSync, jobId: string) {
	return db.prepare('SELECT last_run_at, last_status, last_error FROM jobs WHERE id = ?').get(jobId) as {
		last_run_at: string | null
		last_status: string | null
		last_error: string | null
	}
}

function insertJob(
	db: DatabaseSync,
	row: {
		id: string
		packageName: string
		lastRunAt: string | null
		lastStatus: string | null
		lastError: string | null
		updatedAt: string
	},
) {
	db.prepare(
		`INSERT INTO jobs (id, package_name, last_run_at, last_status, last_error, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(row.id, row.packageName, row.lastRunAt, row.lastStatus, row.lastError, row.updatedAt)
}

describe('job run last_run_at', () => {
	it('jobRunStart does not write jobs.last_run_at (schedule anchor stays for cron claim)', () => {
		const source = readFileSync(here('../cells/user-cell.ts'), 'utf8')
		const start = source.indexOf('async jobRunStart')
		const finish = source.indexOf('async jobRunFinish')
		assert.ok(start >= 0 && finish > start, 'jobRunStart/jobRunFinish markers present')
		const body = source.slice(start, finish)
		assert.doesNotMatch(
			body,
			/last_run_at = \?/,
			'jobRunStart must not write last_run_at (manual must not move the schedule anchor)',
		)
		assert.match(source, /this\.withLatestRun\(this\.rowToJob/, 'jobList/jobGet call withLatestRun for display fields')
		assert.match(
			source,
			/SELECT started_at, status, error FROM job_runs/,
			'display lastStatus comes from the same latest job_runs row as lastRunAt',
		)
		assert.match(
			source,
			/DELETE FROM job_runs WHERE job_id IN \(SELECT id FROM jobs WHERE package_name = \?\)/,
			'packageDelete must drop job_runs so a reinstall cannot inherit prior display',
		)
	})

	it('manual runs surface last-run time from job_runs without moving jobs.last_run_at', () => {
		const db = new DatabaseSync(':memory:')
		db.exec(jobsSchema)
		insertJob(db, {
			id: 'pkg#nightly',
			packageName: 'pkg',
			lastRunAt: null,
			lastStatus: null,
			lastError: null,
			updatedAt: '2026-01-01T00:00:00.000Z',
		})

		db.prepare(`INSERT INTO job_runs (id, job_id, trigger, started_at, status) VALUES (?, ?, ?, ?, 'running')`).run(
			'jobrun_1',
			'pkg#nightly',
			'manual',
			'2026-04-01T12:00:00.000Z',
		)
		db.prepare('UPDATE job_runs SET finished_at = ?, status = ?, logs_json = ? WHERE id = ?').run(
			'2026-04-01T12:00:01.000Z',
			'success',
			'[]',
			'jobrun_1',
		)
		db.prepare('UPDATE jobs SET last_status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
			'success',
			null,
			'2026-04-01T12:00:01.000Z',
			'pkg#nightly',
		)

		const job = readJobColumns(db, 'pkg#nightly')
		assert.equal(job.last_run_at, null, 'manual must leave the schedule-anchor column alone')
		assert.equal(job.last_status, 'success')
		assert.deepEqual(displayFromLatestRun(db, 'pkg#nightly', job), {
			lastRunAt: '2026-04-01T12:00:00.000Z',
			lastStatus: 'success',
			lastError: null,
		})
	})

	it('manual run after a cron claim still moves the displayed last-run time', () => {
		const db = new DatabaseSync(':memory:')
		db.exec(jobsSchema)
		insertJob(db, {
			id: 'pkg#nightly',
			packageName: 'pkg',
			lastRunAt: '2026-04-01T10:00:00.000Z',
			lastStatus: 'success',
			lastError: null,
			updatedAt: '2026-04-01T10:00:00.000Z',
		})
		db.prepare(
			`INSERT INTO job_runs (id, job_id, trigger, started_at, finished_at, status, logs_json)
			 VALUES (?, ?, 'cron', ?, ?, 'success', '[]')`,
		).run('jobrun_cron', 'pkg#nightly', '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:01.000Z')
		db.prepare(
			`INSERT INTO job_runs (id, job_id, trigger, started_at, finished_at, status, logs_json)
			 VALUES (?, ?, 'manual', ?, ?, 'success', '[]')`,
		).run('jobrun_manual', 'pkg#nightly', '2026-04-01T12:00:00.000Z', '2026-04-01T12:00:01.000Z')
		db.prepare('UPDATE jobs SET last_status = ?, updated_at = ? WHERE id = ?').run(
			'success',
			'2026-04-01T12:00:01.000Z',
			'pkg#nightly',
		)

		const job = readJobColumns(db, 'pkg#nightly')
		assert.equal(job.last_run_at, '2026-04-01T10:00:00.000Z', 'cron claim column stays the schedule anchor')
		assert.deepEqual(displayFromLatestRun(db, 'pkg#nightly', job), {
			lastRunAt: '2026-04-01T12:00:00.000Z',
			lastStatus: 'success',
			lastError: null,
		})
	})

	it('prior success then in-flight manual run shows running; finish updates status', () => {
		const db = new DatabaseSync(':memory:')
		db.exec(jobsSchema)
		insertJob(db, {
			id: 'pkg#nightly',
			packageName: 'pkg',
			lastRunAt: '2026-04-01T10:00:00.000Z',
			lastStatus: 'success',
			lastError: null,
			updatedAt: '2026-04-01T10:00:01.000Z',
		})
		db.prepare(
			`INSERT INTO job_runs (id, job_id, trigger, started_at, finished_at, status, logs_json)
			 VALUES (?, ?, 'cron', ?, ?, 'success', '[]')`,
		).run('jobrun_prior', 'pkg#nightly', '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:01.000Z')

		db.prepare(`INSERT INTO job_runs (id, job_id, trigger, started_at, status) VALUES (?, ?, ?, ?, 'running')`).run(
			'jobrun_manual',
			'pkg#nightly',
			'manual',
			'2026-04-01T12:00:00.000Z',
		)

		const during = readJobColumns(db, 'pkg#nightly')
		assert.equal(during.last_run_at, '2026-04-01T10:00:00.000Z', 'manual start must not move the schedule anchor')
		assert.equal(during.last_status, 'success', 'jobs.last_status stays until finish (display comes from job_runs)')
		assert.deepEqual(
			displayFromLatestRun(db, 'pkg#nightly', during),
			{
				lastRunAt: '2026-04-01T12:00:00.000Z',
				lastStatus: 'running',
				lastError: null,
			},
			'UI shows the in-flight run as running beside its started_at',
		)

		db.prepare('UPDATE job_runs SET finished_at = ?, status = ?, error = ?, logs_json = ? WHERE id = ?').run(
			'2026-04-01T12:00:02.000Z',
			'success',
			null,
			'[]',
			'jobrun_manual',
		)
		db.prepare('UPDATE jobs SET last_status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
			'success',
			null,
			'2026-04-01T12:00:02.000Z',
			'pkg#nightly',
		)

		const after = readJobColumns(db, 'pkg#nightly')
		assert.equal(after.last_run_at, '2026-04-01T10:00:00.000Z', 'finish still leaves the schedule anchor alone')
		assert.deepEqual(displayFromLatestRun(db, 'pkg#nightly', after), {
			lastRunAt: '2026-04-01T12:00:00.000Z',
			lastStatus: 'success',
			lastError: null,
		})
	})

	it('package delete drops job_runs so a reinstall with the same id shows no prior run', () => {
		const db = new DatabaseSync(':memory:')
		db.exec(jobsSchema)
		insertJob(db, {
			id: '@scope/pkg#nightly',
			packageName: '@scope/pkg',
			lastRunAt: '2026-04-01T10:00:00.000Z',
			lastStatus: 'error',
			lastError: 'boom',
			updatedAt: '2026-04-01T10:00:01.000Z',
		})
		db.prepare(
			`INSERT INTO job_runs (id, job_id, trigger, started_at, finished_at, status, error, logs_json)
			 VALUES (?, ?, 'manual', ?, ?, 'error', ?, '[]')`,
		).run('jobrun_old', '@scope/pkg#nightly', '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:01.000Z', 'boom')

		db.prepare('DELETE FROM job_runs WHERE job_id IN (SELECT id FROM jobs WHERE package_name = ?)').run('@scope/pkg')
		db.prepare('DELETE FROM jobs WHERE package_name = ?').run('@scope/pkg')

		insertJob(db, {
			id: '@scope/pkg#nightly',
			packageName: '@scope/pkg',
			lastRunAt: null,
			lastStatus: null,
			lastError: null,
			updatedAt: '2026-04-02T00:00:00.000Z',
		})

		const fresh = readJobColumns(db, '@scope/pkg#nightly')
		assert.equal(fresh.last_run_at, null)
		assert.equal(fresh.last_status, null)
		assert.deepEqual(
			displayFromLatestRun(db, '@scope/pkg#nightly', fresh),
			{ lastRunAt: null, lastStatus: null, lastError: null },
			'reinstalled job must not inherit orphaned job_runs display',
		)
	})
})
