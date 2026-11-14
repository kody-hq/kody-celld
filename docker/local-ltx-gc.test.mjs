import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, it } from 'node:test'
import {
	buildChain,
	parseLtxKey,
	planLocalLtxGc,
	planRestore,
	retentionGraceMs,
	runLocalLtxGc,
} from './local-ltx-gc.mjs'

const day = 24 * 60 * 60 * 1000
const now = 100 * day
const old = now - 2 * day
const fresh = now - 60_000
const hex = (n) => n.toString(16).padStart(16, '0')
const ltx = (cell, epoch, level, min, max) =>
	`cells/${cell}/ltx/e${epoch}/${level.toString(16).padStart(4, '0')}/${hex(min)}-${hex(max)}.ltx`

const dirs = []
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function makeStore(objects) {
	const dir = mkdtempSync(join(tmpdir(), 'ltx-gc-'))
	dirs.push(dir)
	const path = join(dir, 'objects.sqlite3')
	const db = new DatabaseSync(path)
	db.exec(`CREATE TABLE objects (key TEXT PRIMARY KEY, body BLOB NOT NULL, etag INTEGER NOT NULL,
		modified_ms INTEGER NOT NULL, attributes TEXT NOT NULL)`)
	const put = db.prepare("INSERT INTO objects VALUES (?, zeroblob(?), 1, ?, '{}')")
	db.exec('BEGIN')
	for (const [key, modifiedMs, bytes = 100] of objects) put.run(key, bytes, modifiedMs)
	db.exec('COMMIT')
	db.close()
	return path
}

function keys(path) {
	const db = new DatabaseSync(path, { readOnly: true })
	try {
		return db
			.prepare('SELECT key FROM objects ORDER BY key')
			.all()
			.map((row) => row.key)
	} finally {
		db.close()
	}
}

/** Files of one cell epoch as celld's restore planner lists them. */
function epochFiles(allKeys, cell, epoch, modifiedMs = old) {
	return allKeys
		.map((key) => ({ key, modifiedMs, ...parseLtxKey(key) }))
		.filter((f) => f.cell === cell && f.epoch === epoch)
}

/** L0 objects 1..n, one per txid, all older than the grace. */
const l0s = (cell, epoch, from, to, modifiedMs = old) =>
	Array.from({ length: to - from + 1 }, (_, i) => [ltx(cell, epoch, 0, BigInt(from + i), BigInt(from + i)), modifiedMs])

describe('local LTX cleanup (#179)', () => {
	it('ports celld calc_restore_plan: snapshot anchor, longest contiguous pick, contiguity check', () => {
		const files = [
			ltx('c', 1, 0, 1n, 1n),
			ltx('c', 1, 0, 2n, 2n),
			ltx('c', 1, 0, 3n, 3n),
			ltx('c', 1, 1, 1n, 2n),
			ltx('c', 1, 9, 1n, 1n),
		].map((key) => ({ key, modifiedMs: old, ...parseLtxKey(key) }))
		assert.deepEqual(
			planRestore(files).map((f) => f.key),
			[ltx('c', 1, 9, 1n, 1n), ltx('c', 1, 1, 1n, 2n), ltx('c', 1, 0, 3n, 3n)],
		)
		assert.deepEqual(
			planRestore(files, 2n).map((f) => f.key),
			[ltx('c', 1, 9, 1n, 1n), ltx('c', 1, 1, 1n, 2n)],
		)
		const gap = files.filter((f) => f.key !== ltx('c', 1, 0, 3n, 3n))
		gap.push({ key: ltx('c', 1, 0, 5n, 5n), modifiedMs: old, ...parseLtxKey(ltx('c', 1, 0, 5n, 5n)) })
		assert.throws(() => planRestore(gap), /non-contiguous/)
	})

	it('deletes only L0 objects covered by an L1+ object older than the grace; dry-run changes nothing', () => {
		const path = makeStore([
			...l0s('a', 3, 1, 10),
			[ltx('a', 3, 9, 1n, 6n), old],
			[ltx('a', 3, 1, 7n, 9n), fresh],
			['cells/a/own.json', old],
		])
		const dry = runLocalLtxGc(path, { dryRun: true, graceMs: day, nowMs: now })
		assert.deepEqual(
			dry.delete,
			l0s('a', 3, 1, 6).map(([key]) => key),
		)
		assert.equal(dry.bytes, 600)
		assert.equal(keys(path).length, 13, 'dry-run deletes nothing')
		const real = runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now })
		assert.deepEqual(real.delete, dry.delete)
		const left = keys(path)
		assert.equal(left.length, 7)
		assert.ok(left.includes(ltx('a', 3, 0, 7n, 7n)), 'L0 covered only by a young L1 stays for point-in-time restores')
		assert.ok(left.includes('cells/a/own.json'))
		assert.deepEqual(runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now }).delete, [], 'idempotent')
	})

	it('restores the same state from the current and previous epoch after cleanup, at latest and inside the grace', () => {
		const objects = [
			...l0s('u', 4, 1, 20),
			[ltx('u', 4, 9, 1n, 12n), old],
			[ltx('u', 4, 1, 13n, 16n), old],
			...l0s('u', 5, 21, 40),
			[ltx('u', 5, 9, 1n, 30n), old],
			[ltx('u', 5, 1, 31n, 36n), fresh],
		]
		const path = makeStore(objects)
		const before = keys(path)
		runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now })
		const left = keys(path)
		for (const [epoch, coveredUpTo] of [
			[4, 16n],
			[5, 30n],
		]) {
			const was = epochFiles(before, 'u', epoch)
			const is = epochFiles(left, 'u', epoch)
			assert.ok(is.length < was.length, `e${epoch} shrank`)
			const reach = (plan) => plan[plan.length - 1].max
			assert.equal(reach(planRestore(is)), reach(planRestore(was)), `e${epoch} latest restore reaches the same txid`)
			assert.ok(planRestore(is).every((f) => left.includes(f.key)))
			const top = reach(planRestore(was))
			for (let txid = coveredUpTo; txid <= top; txid++) {
				assert.equal(reach(planRestore(is, txid)), txid, `e${epoch} point-in-time restore to ${txid}`)
			}
		}
	})

	it('refuses to run without a positive grace and parses CELLD_LTX_RETENTION_SECS strictly', () => {
		assert.throws(() => planLocalLtxGc([], { nowMs: now, graceMs: 0 }), /positive retention grace/)
		assert.equal(retentionGraceMs({}), 0)
		assert.equal(retentionGraceMs({ CELLD_LTX_RETENTION_SECS: '0' }), 0)
		assert.equal(retentionGraceMs({ CELLD_LTX_RETENTION_SECS: '86400' }), day)
		assert.throws(() => retentionGraceMs({ CELLD_LTX_RETENTION_SECS: '1d' }), /whole seconds/)
	})

	it('keeps a cell whose restore already fails instead of guessing', () => {
		const path = makeStore([...l0s('g', 2, 1, 3), [ltx('g', 2, 9, 1n, 2n), old], [ltx('g', 2, 0, 9n, 9n), old]])
		const result = runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now })
		assert.deepEqual(result.delete, [])
		assert.match(result.kept[0].reason, /restore already fails.*non-contiguous/)
	})

	it('keeps a cell when the covering fold crosses a continuation cut, so the epoch chain link survives', () => {
		// e2 continues e1 after txid 4 (no snapshot); e1 folded 3..6 after the cut.
		const objects = [
			[ltx('x', 1, 9, 1n, 2n), old],
			...l0s('x', 1, 3, 6),
			[ltx('x', 1, 1, 3n, 6n), old],
			...l0s('x', 2, 5, 8),
		]
		const path = makeStore(objects)
		const result = runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now })
		assert.deepEqual(result.delete, [])
		assert.match(result.kept[0].reason, /restore would change from "spans=e1@1,e2@5 reach=8"/)
		assert.equal(keys(path).length, objects.length)
	})

	it('follows a continuation chain across epochs when the fold stays inside the cut', () => {
		const path = makeStore([
			[ltx('y', 1, 9, 1n, 2n), old],
			...l0s('y', 1, 3, 4),
			[ltx('y', 1, 1, 3n, 4n), old],
			...l0s('y', 2, 5, 8),
		])
		const result = runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now })
		assert.deepEqual(
			result.delete,
			l0s('y', 1, 3, 4).map(([key]) => key),
		)
		const left = keys(path)
		const epochs = [1, 2].map((epoch) => ({ epoch, files: epochFiles(left, 'y', epoch) }))
		const spans = buildChain(epochs)
		assert.deepEqual(
			spans.map((s) => [s.epoch, s.lo]),
			[
				[1, 1n],
				[2, 5n],
			],
		)
		assert.equal(planRestore(spans.flatMap((s) => s.files)).at(-1).max, 8n)
	})

	it('rolls back to the untouched store when the process dies mid-cleanup', async () => {
		const path = makeStore([...l0s('k', 1, 1, 30_000), [ltx('k', 1, 9, 1n, 30_000n), old]])
		const child = spawn(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import { runLocalLtxGc } from ${JSON.stringify(new URL('./local-ltx-gc.mjs', import.meta.url).href)}
				runLocalLtxGc(${JSON.stringify(path)}, { dryRun: false, graceMs: ${day}, nowMs: ${now} })`,
			],
			{ stdio: 'ignore' },
		)
		const exited = new Promise((resolve) => child.on('exit', resolve))
		while (!existsSync(`${path}-journal`) && child.exitCode === null) await new Promise((r) => setTimeout(r, 1))
		child.kill('SIGKILL')
		await exited
		const count = keys(path).length
		assert.ok(count === 30_001 || count === 1, `all or nothing, got ${count} objects`)
		runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now })
		assert.deepEqual(keys(path), [ltx('k', 1, 9, 1n, 30_000n)])
	})

	it('waits for a concurrent compaction and plans against what it committed', async () => {
		const path = makeStore([...l0s('p', 7, 1, 10), [ltx('p', 7, 9, 1n, 4n), old]])
		const compactor = spawn(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import { DatabaseSync } from 'node:sqlite'
				const db = new DatabaseSync(${JSON.stringify(path)})
				db.exec('BEGIN IMMEDIATE')
				db.prepare("INSERT INTO objects VALUES (?, zeroblob(10), 1, ?, '{}')").run(${JSON.stringify(ltx('p', 7, 1, 5n, 8n))}, ${old})
				process.stdout.write('locked\\n')
				setTimeout(() => { db.exec('COMMIT'); db.close() }, 300)`,
			],
			{ stdio: ['ignore', 'pipe', 'inherit'] },
		)
		await new Promise((resolve) => compactor.stdout.once('data', resolve))
		const result = runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now })
		await new Promise((resolve) => compactor.on('exit', resolve))
		assert.deepEqual(
			result.delete,
			l0s('p', 7, 1, 8).map(([key]) => key),
		)
		const files = epochFiles(keys(path), 'p', 7)
		assert.equal(planRestore(files).at(-1).max, 10n)
	})

	it('online passes keep a cell big enough for a paged restore, start passes clean it', () => {
		const objects = [...l0s('big', 1, 1, 10), [ltx('big', 1, 9, 1n, 6n), old, 1000]]
		const online = runLocalLtxGc(makeStore(objects), { dryRun: true, graceMs: day, nowMs: now, pageableBytes: 2000 })
		assert.deepEqual(online.delete, [])
		assert.match(online.kept[0].reason, /2000 bytes is at or over the paged restore size/)
		assert.equal(
			runLocalLtxGc(makeStore(objects), { dryRun: true, graceMs: day, nowMs: now, pageableBytes: 2001 }).delete.length,
			6,
		)
		assert.equal(runLocalLtxGc(makeStore(objects), { dryRun: true, graceMs: day, nowMs: now }).delete.length, 6)
	})

	it('keeps latest and in-grace restores after repeated passes under concurrent writes and compactions', async () => {
		const path = makeStore([...l0s('w', 2, 1, 50), [ltx('w', 2, 9, 1n, 1n), old], [ltx('w', 2, 1, 2n, 50n), old]])
		// A celld stand-in: one L0 per commit, and every 25 txids an L1 compaction of them.
		const writer = spawn(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import { DatabaseSync } from 'node:sqlite'
				const hex = (n) => n.toString(16).padStart(16, '0')
				const key = (level, min, max) => 'cells/w/ltx/e2/' + level.toString(16).padStart(4, '0') + '/' + hex(min) + '-' + hex(max) + '.ltx'
				const db = new DatabaseSync(${JSON.stringify(path)}, { timeout: 30000 })
				const put = db.prepare("INSERT INTO objects VALUES (?, zeroblob(100), 1, ?, '{}')")
				let txid = 50
				const pause = new Int32Array(new SharedArrayBuffer(4))
				const deadline = Date.now() + 1500
				while (Date.now() < deadline) {
					txid++
					put.run(key(0, txid, txid), ${old})
					if (txid % 25 === 0) put.run(key(1, txid - 24, txid), ${old})
					Atomics.wait(pause, 0, 0, 1)
				}
				db.close()
				process.stdout.write(String(txid))`,
			],
			{ stdio: ['ignore', 'pipe', 'inherit'] },
		)
		let out = ''
		writer.stdout.on('data', (chunk) => (out += chunk))
		const exited = new Promise((resolve) => writer.on('exit', resolve))
		let passes = 0
		let deleted = 0
		while (writer.exitCode === null) {
			deleted += runLocalLtxGc(path, { dryRun: false, graceMs: day, nowMs: now }).delete.length
			passes++
			await new Promise((r) => setTimeout(r, 20))
		}
		assert.equal(await exited, 0)
		const last = BigInt(out)
		assert.ok(passes > 5 && deleted > 0, `ran ${passes} passes, deleted ${deleted}`)
		const left = keys(path)
		const files = epochFiles(left, 'w', 2)
		assert.equal(planRestore(files).at(-1).max, last, 'latest restore reaches the last committed txid')
		const covered = Number(last) - (Number(last) % 25)
		for (let txid = covered + 1; txid <= Number(last); txid++) {
			assert.ok(left.includes(ltx('w', 2, 0, BigInt(txid), BigInt(txid))), `uncompacted L0 ${txid} kept`)
		}
		// Every txid committed after the newest (aged) compaction stays point-in-time restorable.
		for (let txid = BigInt(covered); txid <= last; txid++) {
			assert.equal(planRestore(files, txid).at(-1).max, txid, `restore to ${txid}`)
		}
	})
})
