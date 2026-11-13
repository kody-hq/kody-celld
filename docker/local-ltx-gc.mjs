/**
 * Single-mode cleanup of L0 LTX objects that a later compaction already covers
 * (kody-hq/kody-celld#179). celld v0.6 deletes LTX objects only by whole epoch
 * (see epoch-gc-plan.mjs), so on the local store every L0 object stays for the
 * life of its epoch even after an L1+ file or snapshot holds the same range.
 *
 * An L0 object is deleted only when all of these hold, and anything uncertain
 * keeps it (leak bytes; never drop an object a restore still needs):
 * - a level 1+ object of the same cell and epoch covers its whole TXID range;
 * - that covering object is older than the retention grace
 *   (CELLD_LTX_RETENTION_SECS, the same grace epoch GC uses), so no
 *   point-in-time restore inside the grace can need the L0 range;
 * - the restore plan for that epoch (ported below from celld) succeeds before
 *   and after, reaching the same TXID. Otherwise the whole epoch is kept and,
 *   if only the "after" plan breaks, the run throws.
 * Epochs themselves are untouched, so the previous-epoch fallback and the
 * epoch GC rules stay exactly as celld defines them.
 *
 * Runs before celld starts (no paged reads can be pinned, no compaction can
 * race), inside one IMMEDIATE transaction that re-reads the listing under the
 * write lock: a crash rolls back to the untouched store.
 */
import { DatabaseSync } from 'node:sqlite'

export const SNAPSHOT_LEVEL = 9
const ltxKey = /^cells\/([^/]+)\/ltx\/e(\d+)\/([0-9a-f]{4})\/([0-9a-f]{16})-([0-9a-f]{16})\.ltx$/
const listLtx = `SELECT key, modified_ms AS modifiedMs, length(body) AS bytes FROM objects
	WHERE key >= 'cells/' AND key < 'cells0' AND key LIKE '%.ltx' ORDER BY key`

/** @param {string} key */
export function parseLtxKey(key) {
	const match = ltxKey.exec(key)
	if (!match) return null
	return {
		cell: match[1],
		epoch: Number(match[2]),
		level: Number.parseInt(match[3], 16),
		min: BigInt(`0x${match[4]}`),
		max: BigInt(`0x${match[5]}`),
	}
}

/**
 * Pure port of denoland/celld v0.6.1 `calc_restore_plan`
 * (crates/ltx/src/replica.rs). Keep in lockstep when bumping CELLD_VERSION.
 * `files` must be sorted by key (level, then min TXID), like a store listing.
 * @param {{ key: string, level: number, min: bigint, max: bigint, modifiedMs: number }[]} files
 * @param {bigint} txid 0n for latest
 */
export function planRestore(files, txid = 0n) {
	const infos = []
	let snapshot = null
	for (const file of files.filter((f) => f.level === SNAPSHOT_LEVEL)) {
		if (txid !== 0n && file.max > txid) continue
		snapshot = file
	}
	if (snapshot) infos.push(snapshot)
	let currentMax = snapshot ? snapshot.max : 0n
	if (txid !== 0n && currentMax >= txid) return infos
	const cursors = []
	for (let level = SNAPSHOT_LEVEL - 1; level >= 0; level--) {
		cursors.push({ files: files.filter((f) => f.level === level), idx: 0, current: null, candidate: null, done: false })
	}
	const ensureCurrent = (c) => {
		if (c.done || c.current) return
		if (c.idx >= c.files.length) c.done = true
		else c.current = c.files[c.idx++]
	}
	const better = (curr, next) => {
		if (next.max !== curr.max) return next.max > curr.max
		if (next.min !== curr.min) return next.min < curr.min
		if (next.level !== curr.level) return next.level > curr.level
		return next.modifiedMs < curr.modifiedMs
	}
	const refresh = (c) => {
		if (c.done) return
		if (c.candidate && c.candidate.max <= currentMax) c.candidate = null
		for (;;) {
			ensureCurrent(c)
			if (c.done) return
			const info = c.current
			if (info.min > currentMax + 1n) return
			c.current = null
			if (info.max <= currentMax) continue
			if (txid !== 0n && info.max > txid) continue
			if (!c.candidate || better(c.candidate, info)) c.candidate = info
		}
	}
	for (;;) {
		let next = null
		for (const c of cursors) {
			refresh(c)
			if (c.candidate && (!next || better(next.candidate, c.candidate))) next = c
		}
		if (!next) break
		const chosen = next.candidate
		next.candidate = null
		if (chosen.max <= currentMax) continue
		currentMax = chosen.max
		infos.push(chosen)
		if (txid !== 0n && currentMax >= txid) break
	}
	if (infos.length > 0 && txid === 0n) {
		for (const c of cursors) {
			ensureCurrent(c)
			if (c.current && c.current.min > currentMax + 1n) {
				throw new Error(`non-contiguous ltx files: have up to ${currentMax} but next file starts at ${c.current.min}`)
			}
		}
	}
	if (infos.length === 0) throw new Error('transaction not available')
	if (txid !== 0n && currentMax < txid) throw new Error('transaction not available')
	return infos
}

/**
 * @param {{ key: string, modifiedMs: number, bytes: number }[]} rows store listing sorted by key
 * @param {{ nowMs: number, graceMs: number }} options
 */
export function planLocalLtxGc(rows, { nowMs, graceMs }) {
	if (!(graceMs > 0)) throw new Error(`local LTX cleanup needs a positive retention grace, got ${graceMs}ms`)
	const epochs = new Map()
	for (const row of rows) {
		const parsed = parseLtxKey(row.key)
		if (!parsed) continue
		const id = `${parsed.cell}/e${parsed.epoch}`
		if (!epochs.has(id)) epochs.set(id, [])
		epochs.get(id).push({ ...row, ...parsed })
	}
	const remove = []
	const kept = []
	for (const [id, files] of epochs) {
		const covers = files.filter((f) => f.level >= 1 && nowMs - f.modifiedMs >= graceMs)
		const covered = new Set(files.filter((f) => f.level === 0 && covers.some((g) => g.min <= f.min && g.max >= f.max)))
		if (covered.size === 0) continue
		let before
		try {
			before = planRestore(files)
		} catch (error) {
			kept.push({ epoch: id, reason: `restore plan already fails: ${error.message}` })
			continue
		}
		const after = planRestore(files.filter((f) => !covered.has(f)))
		const reach = (plan) => plan[plan.length - 1].max
		if (reach(after) !== reach(before)) {
			throw new Error(
				`${id}: dropping covered L0 objects would move the restore point from ${reach(before)} to ${reach(after)}`,
			)
		}
		remove.push(...covered)
	}
	return {
		delete: remove.map((f) => f.key),
		bytes: remove.reduce((sum, f) => sum + f.bytes, 0),
		kept,
	}
}

/**
 * @param {string} databasePath the local store's objects.sqlite3
 * @param {{ dryRun: boolean, graceMs: number, nowMs?: number }} options
 */
export function runLocalLtxGc(databasePath, { dryRun, graceMs, nowMs = Date.now() }) {
	const db = new DatabaseSync(databasePath, { timeout: 30_000, readOnly: dryRun })
	try {
		if (dryRun) return { dryRun, ...planLocalLtxGc(db.prepare(listLtx).all(), { nowMs, graceMs }) }
		db.exec('BEGIN IMMEDIATE')
		try {
			const plan = planLocalLtxGc(db.prepare(listLtx).all(), { nowMs, graceMs })
			const remove = db.prepare('DELETE FROM objects WHERE key = ?')
			for (const key of plan.delete) {
				if (Number(remove.run(key).changes) !== 1) throw new Error(`${databasePath}: ${key} vanished mid-cleanup`)
			}
			db.exec('COMMIT')
			return { dryRun, ...plan }
		} catch (error) {
			db.exec('ROLLBACK')
			throw error
		}
	} finally {
		db.close()
	}
}

/** Retention grace from CELLD_LTX_RETENTION_SECS; 0 or unset keeps celld's no-deletion default. */
export function retentionGraceMs(env = process.env) {
	const raw = env.CELLD_LTX_RETENTION_SECS
	if (raw === undefined || raw === '' || raw === '0') return 0
	if (!/^\d+$/.test(raw)) throw new Error(`CELLD_LTX_RETENTION_SECS must be whole seconds, got ${JSON.stringify(raw)}`)
	return Number(raw) * 1000
}
