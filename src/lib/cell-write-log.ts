/**
 * Operator debug switch: with `KODY_DEBUG_CELL_WRITES=1` every SQL statement
 * that changes rows in a cell is logged with the cell and the calling method,
 * so an operator can see what each committed transaction (L0 object) holds.
 * Off by default; nothing is recorded or sent anywhere beyond the log line.
 */
export function logCellWrites(ctx: DurableObjectState, cell: string, env: { KODY_DEBUG_CELL_WRITES?: string }) {
	if (env.KODY_DEBUG_CELL_WRITES !== '1') return
	const sql = ctx.storage.sql
	const exec = sql.exec.bind(sql)
	sql.exec = ((query: string, ...bindings: Array<SqlStorageValue>) => {
		const cursor = exec(query, ...bindings)
		if (cursor.rowsWritten > 0) {
			console.log(
				`[kody-celld] cell-write ${cell} rows=${cursor.rowsWritten} via=${caller()} ${query.replace(/\s+/g, ' ').trim().slice(0, 200)}`,
			)
		}
		return cursor
	}) as typeof sql.exec
}

function caller() {
	const frames = (new Error().stack ?? '').split('\n').slice(1)
	const frame = frames.find((line) => !line.includes('cell-write-log.ts:')) ?? ''
	return /at (?:async )?([\w$.<>]+)/.exec(frame)?.[1] ?? 'unknown'
}
