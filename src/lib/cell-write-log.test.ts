import assert from 'node:assert/strict'
import test from 'node:test'
import { logCellWrites } from './cell-write-log.ts'

function fakeCtx(rowsWritten: number) {
	const sql = { exec: (_query: string, ..._bindings: Array<unknown>) => ({ rowsWritten }) }
	return { ctx: { storage: { sql } } as unknown as DurableObjectState, sql }
}

function captureLogs(run: () => void) {
	const lines: Array<string> = []
	const original = console.log
	console.log = (line: string) => lines.push(line)
	try {
		run()
	} finally {
		console.log = original
	}
	return lines
}

test('cell write logging is off unless KODY_DEBUG_CELL_WRITES=1', () => {
	const { ctx, sql } = fakeCtx(1)
	const exec = sql.exec
	logCellWrites(ctx, 'RegistryCell', {})
	assert.equal(sql.exec, exec)
})

test('cell write logging names the cell, caller and statement of row-changing SQL only', () => {
	const written = fakeCtx(2)
	logCellWrites(written.ctx, 'RegistryCell', { KODY_DEBUG_CELL_WRITES: '1' })
	const lines = captureLogs(function touchToken() {
		written.sql.exec('UPDATE tokens\n\t\tSET last_used_at = ? WHERE token_hash = ?', 'now', 'bound-secret-value')
	})
	assert.equal(lines.length, 1)
	assert.match(
		lines[0] ?? '',
		/^\[kody-celld\] cell-write RegistryCell rows=2 via=touchToken UPDATE tokens SET last_used_at = \?/,
	)
	assert.doesNotMatch(lines[0] ?? '', /bound-secret-value/)

	const inlined = fakeCtx(1)
	logCellWrites(inlined.ctx, 'PackageStorageCell', { KODY_DEBUG_CELL_WRITES: '1' })
	const [inlinedLine] = captureLogs(() =>
		inlined.sql.exec("INSERT INTO kv VALUES ('api-key', 'it''s secret', X'deadbeef')"),
	)
	assert.match(inlinedLine ?? '', /INSERT INTO kv VALUES \('\?', '\?', '\?'\)$/)

	const read = fakeCtx(0)
	logCellWrites(read.ctx, 'UserCell', { KODY_DEBUG_CELL_WRITES: '1' })
	assert.deepEqual(
		captureLogs(() => read.sql.exec('SELECT 1')),
		[],
	)
})
