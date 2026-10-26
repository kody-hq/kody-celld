import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url).href)

/**
 * Manual Run now must show a last-run time without writing jobs.last_run_at
 * (that column anchors interval/once rescheduling). The account UI reads
 * lastRunAt from jobList/jobGet, which fall back to the latest job_runs row.
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

function displayLastRunAt(db: DatabaseSync, jobId: string, columnLastRunAt: string | null) {
	const latest = db
		.prepare('SELECT started_at FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1')
		.get(jobId) as { started_at: string } | undefined
	if (!latest) return columnLastRunAt
	if (!columnLastRunAt || latest.started_at > columnLastRunAt) return latest.started_at
	return columnLastRunAt
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
		assert.match(
			source,
			/withLatestRunAt/,
			'jobList/jobGet fall back to job_runs for last-run display after manual runs',
		)
	})

	it('manual runs surface last-run time from job_runs without moving jobs.last_run_at', () => {
		const db = new DatabaseSync(':memory:')
		db.exec(jobsSchema)
		db.prepare(
			`INSERT INTO jobs (id, last_run_at, last_status, last_error, updated_at) VALUES (?, NULL, NULL, NULL, ?)`,
		).run('pkg#nightly', '2026-01-01T00:00:00.000Z')

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

		const job = db.prepare('SELECT last_run_at, last_status FROM jobs WHERE id = ?').get('pkg#nightly') as {
			last_run_at: string | null
			last_status: string | null
		}
		assert.equal(job.last_run_at, null, 'manual must leave the schedule-anchor column alone')
		assert.equal(job.last_status, 'success')
		assert.equal(
			displayLastRunAt(db, 'pkg#nightly', job.last_run_at),
			'2026-04-01T12:00:00.000Z',
			'UI last-run falls back to the latest job_runs.started_at',
		)
	})

	it('manual run after a cron claim still moves the displayed last-run time', () => {
		const db = new DatabaseSync(':memory:')
		db.exec(jobsSchema)
		db.prepare(`INSERT INTO jobs (id, last_run_at, last_status, last_error, updated_at) VALUES (?, ?, ?, NULL, ?)`).run(
			'pkg#nightly',
			'2026-04-01T10:00:00.000Z',
			'success',
			'2026-04-01T10:00:00.000Z',
		)
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

		const job = db.prepare('SELECT last_run_at FROM jobs WHERE id = ?').get('pkg#nightly') as {
			last_run_at: string | null
		}
		assert.equal(job.last_run_at, '2026-04-01T10:00:00.000Z', 'cron claim column stays the schedule anchor')
		assert.equal(
			displayLastRunAt(db, 'pkg#nightly', job.last_run_at),
			'2026-04-01T12:00:00.000Z',
			'UI last-run prefers the later manual job_runs row',
		)
	})
})
