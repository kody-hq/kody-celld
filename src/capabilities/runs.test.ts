import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { CapabilityContext } from './define.ts'
import { runList } from './runs.ts'
import { ensureRunTriageColumns, runListRows } from '../runs/triage-store.ts'

function memorySql() {
	const db = new DatabaseSync(':memory:')
	const calls: Array<{ query: string; params: Array<string | number | null> }> = []
	const sql = {
		exec(query: string, ...params: Array<string | number | null>) {
			calls.push({ query, params })
			const statement = db.prepare(query)
			if (/^\s*select/i.test(query)) return { toArray: () => statement.all(...params), rowsWritten: 0 }
			const result = statement.run(...params)
			return { toArray: () => [], rowsWritten: Number(result.changes) }
		},
	} as unknown as SqlStorage
	return { sql, calls, close: () => db.close() }
}

const runsDdl = `CREATE TABLE runs (
	id TEXT PRIMARY KEY, kind TEXT NOT NULL, package_name TEXT, idempotency_key TEXT,
	status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER,
	result_json TEXT, error_json TEXT, logs_json TEXT NOT NULL DEFAULT '[]',
	warnings_json TEXT NOT NULL DEFAULT '[]', gateway_json TEXT NOT NULL DEFAULT '[]')`

test('runList uses workflow, error-triage, and limit filters through SQL', async (t) => {
	const { sql, calls, close } = memorySql()
	t.after(close)
	sql.exec(runsDdl)
	ensureRunTriageColumns(sql)
	for (const seed of [
		{ id: 'other-workflow', workflowId: 'wf-other', createdAt: '2026-10-08T12:00:00Z', errorTriage: null },
		{ id: 'ignored', workflowId: 'wf-target', createdAt: '2026-10-08T11:00:00Z', errorTriage: 'ignored' },
		{ id: 'target-new', workflowId: 'wf-target', createdAt: '2026-10-08T10:00:00Z', errorTriage: null },
		{ id: 'target-old', workflowId: 'wf-target', createdAt: '2026-10-08T09:00:00Z', errorTriage: null },
	]) {
		sql.exec(
			`INSERT INTO runs (id, kind, status, created_at, error_json, workflow_id, error_triage) VALUES (?, 'job', 'error', ?, ?, ?, ?)`,
			seed.id,
			seed.createdAt,
			JSON.stringify({ name: 'Error', message: 'boom' }),
			seed.workflowId,
			seed.errorTriage,
		)
	}
	const context = {
		env: {} as CapabilityContext['env'],
		exports: {} as CapabilityContext['exports'],
		user: { id: 'user-1', email: 'owner@example.test' },
		userCell: {
			runList: async (filter: Parameters<typeof runListRows>[1]) => runListRows(sql, filter),
		} as unknown as CapabilityContext['userCell'],
		packageName: null,
		runId: null,
		baseUrl: 'http://example.test',
		fromRuntime: false,
	} satisfies CapabilityContext

	const result = (await runList.handler({ workflow_id: 'wf-target', errorTriage: 'open', limit: 1 }, context)) as {
		runs: Array<{ id: string; workflowId: string | null }>
	}
	assert.equal(result.runs.length, 1)
	assert.equal(result.runs[0]?.id, 'target-new')
	assert.equal(result.runs[0]?.workflowId, 'wf-target')
	const query = calls[calls.length - 1]
	assert.deepEqual(query?.params, ['wf-target', 1])
	assert.match(query?.query ?? '', /error_triage IS NULL\) AND workflow_id = \? ORDER BY/)
})
