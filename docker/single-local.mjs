#!/usr/bin/env node
/**
 * Single-node Docker helpers shared by docker/entrypoint.sh.
 *
 * Production `single` mode must not keep `celld.dev` as the long-running
 * process: that wrapper gives the child a fixed 30s announce deadline
 * (denoland/celld crates/celld/dev.rs), which fails once the local store has
 * enough uncompacted LTX state (kody-hq/kody-celld#89).
 *
 * `celld.dev` is still the only public way to write a deployment into the
 * local object store (`.celld/dev/objects.sqlite3`). This module drives that
 * deploy step, stops the supervisor as soon as `deploy/current.json` is
 * written (last step of celld's deploy::write), then the entrypoint execs the
 * same node argv `celld.dev` would spawn for its child: no announce deadline,
 * and LTX compaction runs.
 *
 * CELLD_NODE matches celld: `dev-` + first 12 hex chars of SHA-256 of the
 * realpath of the project directory (parent of the Wrangler config).
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { realpathSync, existsSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { retentionGraceMs, runLocalLtxGc } from './local-ltx-gc.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const DEPLOY_POINTER = 'deploy/current.json'
const DEFAULT_DEPLOY_TIMEOUT_MS = 10 * 60 * 1000

export function resolveProjectDir(project) {
	const root = realpathSync(project)
	for (const name of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) {
		const config = join(root, name)
		if (existsSync(config)) {
			return dirname(realpathSync(config))
		}
	}
	throw new Error(`no Wrangler config (wrangler.jsonc|json|toml) under ${root}; celld single deploy needs one`)
}

export function celldDevNodeId(projectDir) {
	const digest = createHash('sha256').update(Buffer.from(projectDir)).digest('hex')
	return `dev-${digest.slice(0, 12)}`
}

export function objectsDbPath(stateDir) {
	return join(stateDir, 'objects.sqlite3')
}

/**
 * Read the deploy pointer etag, or null when the store is missing / not ready.
 * Transient SQLite errors (file mid-create, SQLITE_BUSY, missing table) must
 * not abort the deploy poll: celld.dev may still be opening or writing the DB.
 */
export function readDeployPointerEtag(databasePath) {
	if (!existsSync(databasePath)) return null
	let db
	try {
		db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 })
		const row = db.prepare('SELECT etag FROM objects WHERE key = ?').get(DEPLOY_POINTER)
		return row == null ? null : Number(row.etag)
	} catch {
		return null
	} finally {
		try {
			db?.close()
		} catch {
			/* ignore close races while celld.dev still holds the file */
		}
	}
}

const OBJECT_COLUMNS = ['key', 'body', 'etag', 'modified_ms', 'attributes']
export const METADATA_INDEX = 'objects_metadata'
const METADATA_INDEX_COLUMNS = ['key', 'etag', 'modified_ms', 'attributes', '<expr>']

/**
 * Index celld's local store so listings stop reading object bodies
 * (kody-hq/kody-celld#179). celld 0.6 lists the store with
 * `SELECT key, etag, modified_ms, attributes, length(body) FROM objects ORDER BY key`
 * and filters prefixes in Rust; `body` sits before those columns in each row,
 * so every listing walked every object's overflow pages. This covering index
 * serves that query from the index alone. The name and definition match the
 * index proposed for celld's LocalStore, so a celld that creates it makes this
 * a no-op. Remove once the pinned celld ships it.
 */
export function ensureMetadataIndex(databasePath) {
	const db = new DatabaseSync(databasePath, { timeout: 30_000 })
	try {
		const columns = db
			.prepare('SELECT name FROM pragma_table_info(?)')
			.all('objects')
			.map((row) => row.name)
		if (OBJECT_COLUMNS.some((column) => !columns.includes(column))) {
			throw new Error(
				`${databasePath}: objects table has columns [${columns.join(', ')}], expected [${OBJECT_COLUMNS.join(', ')}]; ` +
					'celld changed its local store schema, revisit ensureMetadataIndex',
			)
		}
		const existing = db
			.prepare("SELECT tbl_name FROM sqlite_schema WHERE type = 'index' AND name = ?")
			.get(METADATA_INDEX)
		if (existing) {
			// Expression columns (length(body)) have cid -2 and no name.
			const indexed = db
				.prepare('SELECT cid, name FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno')
				.all(METADATA_INDEX)
				.map((row) => (row.cid === -2 ? '<expr>' : row.name))
			if (existing.tbl_name !== 'objects' || indexed.join(',') !== METADATA_INDEX_COLUMNS.join(',')) {
				throw new Error(
					`${databasePath}: index ${METADATA_INDEX} on ${existing.tbl_name} covers [${indexed.join(', ')}], expected objects [${METADATA_INDEX_COLUMNS.join(', ')}]; ` +
						'listings would still read object bodies, revisit ensureMetadataIndex',
				)
			}
			return { created: false, elapsedMs: 0 }
		}
		const started = Date.now()
		db.exec(`CREATE INDEX ${METADATA_INDEX} ON objects(key, etag, modified_ms, attributes, length(body))`)
		return { created: true, elapsedMs: Date.now() - started }
	} finally {
		db.close()
	}
}

function parseArgs(argv) {
	const out = {
		command: argv[0] ?? '',
		project: '/app',
		state: '',
		port: '8080',
		host: '127.0.0.1',
		celldFlags: [],
		dryRun: false,
	}
	const rest = argv.slice(1)
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i]
		if (arg === '--') {
			out.celldFlags = rest.slice(i + 1)
			break
		}
		if (arg === '--project') {
			out.project = rest[++i] ?? ''
			continue
		}
		if (arg === '--state') {
			out.state = rest[++i] ?? ''
			continue
		}
		if (arg === '--dry-run') {
			out.dryRun = true
			continue
		}
		if (arg === '--online') {
			out.online = true
			continue
		}
		if (arg === '--port') {
			out.port = rest[++i] ?? ''
			continue
		}
		if (arg === '--host') {
			out.host = rest[++i] ?? ''
			continue
		}
		throw new Error(`unknown argument: ${arg}`)
	}
	return out
}

function printNodeEnv({ projectDir, stateDir }) {
	const database = objectsDbPath(stateDir)
	const runtime = join(stateDir, 'runtime')
	const nodeId = celldDevNodeId(projectDir)
	// One line the entrypoint can eval. Values are path-safe (no spaces from us).
	process.stdout.write(
		[
			`CELLD_INTERNAL_DEV_STORE=${shellQuote(database)}`,
			`CELLD_WATCH=${shellQuote(runtime)}`,
			`CELLD_NODE=${shellQuote(nodeId)}`,
		].join(' ') + '\n',
	)
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function signalProcessTree(pid, signal) {
	if (pid == null) return
	// celld.dev puts its node in a new process group; kill the whole tree so a
	// SIGTERM to the supervisor alone cannot leave the node holding the port
	// or the local store lock.
	try {
		process.kill(-pid, signal)
	} catch {
		try {
			process.kill(pid, signal)
		} catch {
			/* already gone */
		}
	}
}

async function waitForListenFree(host, port, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const free = await new Promise((resolve) => {
			const socket = createConnection({ host, port })
			socket.once('connect', () => {
				socket.destroy()
				resolve(false)
			})
			socket.once('error', () => resolve(true))
		})
		if (free) return
		await delay(100)
	}
	throw new Error(
		`port ${host}:${port} still in use after stopping celld.dev; refuse to start the direct node on a contested listener`,
	)
}

async function stopProcess(child, { host, port } = {}) {
	if (child.exitCode == null && child.signalCode == null) {
		signalProcessTree(child.pid, 'SIGTERM')
		const deadline = Date.now() + 40_000
		while (Date.now() < deadline) {
			if (child.exitCode != null || child.signalCode != null) break
			await delay(100)
		}
		if (child.exitCode == null && child.signalCode == null) {
			signalProcessTree(child.pid, 'SIGKILL')
			await delay(200)
		}
	}
	if (host != null && port != null) {
		await waitForListenFree(host, Number(port))
	}
}

async function deployLocal(options) {
	const projectDir = resolveProjectDir(options.project)
	const stateDir = realpathSync(
		(() => {
			mkdirSync(options.state, { recursive: true })
			mkdirSync(join(options.state, 'runtime'), { recursive: true })
			return options.state
		})(),
	)
	const database = objectsDbPath(stateDir)
	const priorEtag = readDeployPointerEtag(database)
	const timeoutMs = Number(process.env.KODY_SINGLE_DEPLOY_TIMEOUT_MS || DEFAULT_DEPLOY_TIMEOUT_MS)
	if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
		throw new Error(`KODY_SINGLE_DEPLOY_TIMEOUT_MS must be >= 1000 (got ${timeoutMs})`)
	}

	const logPath = join(stateDir, '.last-deploy.log')
	const logFd = openSync(logPath, 'w')
	const args = [
		'dev',
		projectDir,
		'--host',
		options.host,
		'--port',
		String(options.port),
		'--no-watch',
		...options.celldFlags,
	]
	// Match celld.dev's child scrub so a leftover fleet env cannot divert this
	// temporary supervisor onto a cloud bucket mid-deploy.
	const env = { ...process.env }
	for (const name of [
		'AWS_DEFAULT_REGION',
		'AWS_REGION',
		'CELLD_ADDR',
		'CELLD_ADVERTISE',
		'CELLD_BUCKET',
		'CELLD_CLOUD',
		'CELLD_INTERNAL_ADDR',
		'CELLD_INTERNAL_DEV_STORE',
		'CELLD_TEST_BUCKET',
		'CELLD_TRUST_FORWARDED_HEADERS',
		'CELLD_UNSAFE_PUBLIC_ADVERTISE',
		'S3_ENDPOINT',
	]) {
		delete env[name]
	}

	process.stderr.write(`[kody-celld] single deploy: writing Worker into ${database} via celld.dev (log: ${logPath})\n`)

	// detached so child.pid is a process-group leader; stopProcess can then
	// signal -pid and tear down both the supervisor and the node it spawned.
	const child = spawn('celld', args, {
		env,
		stdio: ['ignore', logFd, logFd],
		detached: true,
	})
	closeSync(logFd)

	let childError = null
	child.on('error', (error) => {
		childError = error
	})

	const success = () => ({
		projectDir,
		stateDir,
		nodeId: celldDevNodeId(projectDir),
		database,
	})
	const stopOpts = { host: options.host, port: options.port }

	const deadline = Date.now() + timeoutMs
	try {
		while (Date.now() < deadline) {
			if (childError) {
				throw new Error(`failed to start celld.dev: ${childError.message}`)
			}
			const etag = readDeployPointerEtag(database)
			if (etag != null && etag !== priorEtag) {
				process.stderr.write(
					`[kody-celld] single deploy: ${DEPLOY_POINTER} updated (etag ${priorEtag ?? 'none'} -> ${etag}); stopping celld.dev supervisor\n`,
				)
				await stopProcess(child, stopOpts)
				return success()
			}
			if (child.exitCode != null || child.signalCode != null) {
				const code = child.exitCode
				const signal = child.signalCode
				// Announce timeout means deploy_project already finished; treat as
				// success when the pointer moved. If it did not, surface the log.
				const etagAfter = readDeployPointerEtag(database)
				if (etagAfter != null && etagAfter !== priorEtag) {
					await stopProcess(child, stopOpts)
					return success()
				}
				throw new Error(
					`celld.dev exited before updating ${DEPLOY_POINTER}` +
						(code != null ? ` (exit ${code})` : '') +
						(signal != null ? ` (signal ${signal})` : '') +
						`; see ${logPath}`,
				)
			}
			await delay(200)
		}
		const etag = readDeployPointerEtag(database)
		if (etag != null && etag !== priorEtag) {
			await stopProcess(child, stopOpts)
			return success()
		}
		throw new Error(`timed out after ${timeoutMs}ms waiting for ${DEPLOY_POINTER} to update; see ${logPath}`)
	} finally {
		await stopProcess(child, stopOpts)
	}
}

/**
 * Covered-L0 cleanup (local-ltx-gc.mjs); a no-op when CELLD_LTX_RETENTION_SECS keeps celld's no-deletion default.
 * `online` passes run beside the node, so they also keep any cell celld could have restored paged.
 */
function reportLtxGc(database, { dryRun, online = false }) {
	const graceMs = retentionGraceMs()
	if (graceMs === 0) {
		process.stderr.write('[kody-celld] ltx-gc: CELLD_LTX_RETENTION_SECS is 0 or unset, nothing is deleted\n')
		return
	}
	const pageableBytes = online ? pagedRestoreBytes() : Infinity
	const result = runLocalLtxGc(database, { dryRun, graceMs, pageableBytes })
	for (const { scope, reason } of result.kept) {
		process.stderr.write(`[kody-celld] ltx-gc: kept ${scope}: ${reason}\n`)
	}
	if (dryRun) for (const key of result.delete) process.stdout.write(`${key}\n`)
	process.stderr.write(
		`[kody-celld] ltx-gc: ${dryRun ? 'would delete' : 'deleted'} ${result.delete.length} covered L0 objects (${result.bytes} bytes) from ${database} (#179)\n`,
	)
}

/** Chain size from which celld restores a cell paged (CELLD_LTX_PAGED, CELLD_LTX_PAGED_MIN_MB; celld v0.6.1 ltx_repl.rs). */
export function pagedRestoreBytes(env = process.env) {
	const paged = env.CELLD_LTX_PAGED
	if (paged !== undefined && paged !== '' && !['0', 'false', '1', 'true'].includes(paged)) {
		throw new Error(`CELLD_LTX_PAGED must be 0, 1, true or false, got ${JSON.stringify(paged)}`)
	}
	if (paged === '0' || paged === 'false') return Infinity
	const raw = env.CELLD_LTX_PAGED_MIN_MB
	if (raw === undefined || raw === '') return 256 * 2 ** 20
	if (!/^\d+$/.test(raw)) throw new Error(`CELLD_LTX_PAGED_MIN_MB must be whole MiB, got ${JSON.stringify(raw)}`)
	return Number(raw) * 2 ** 20
}

/** Seconds between online covered-L0 passes while the node runs (KODY_LTX_GC_INTERVAL_SECS, default 3600, 0 off). */
export function ltxGcIntervalMs(env = process.env) {
	const raw = env.KODY_LTX_GC_INTERVAL_SECS
	if (raw === undefined || raw === '') return 3600 * 1000
	if (!/^\d+$/.test(raw)) throw new Error(`KODY_LTX_GC_INTERVAL_SECS must be whole seconds, got ${JSON.stringify(raw)}`)
	return Number(raw) * 1000
}

async function ltxGcLoop(database) {
	const intervalMs = ltxGcIntervalMs()
	if (intervalMs === 0 || retentionGraceMs() === 0) {
		process.stderr.write(
			'[kody-celld] ltx-gc: no online passes (KODY_LTX_GC_INTERVAL_SECS or CELLD_LTX_RETENTION_SECS is 0)\n',
		)
		return
	}
	for (;;) {
		await delay(intervalMs)
		try {
			reportLtxGc(database, { dryRun: false, online: true })
		} catch (error) {
			process.stderr.write(`[kody-celld] ltx-gc: online pass FAILED, store left as it was: ${error?.stack || error}\n`)
		}
	}
}

async function main(argv) {
	const options = parseArgs(argv)
	switch (options.command) {
		case 'node-env': {
			if (!options.state) throw new Error('--state is required')
			const projectDir = resolveProjectDir(options.project)
			mkdirSync(join(options.state, 'runtime'), { recursive: true })
			printNodeEnv({ projectDir, stateDir: realpathSync(options.state) })
			return
		}
		case 'node-id': {
			process.stdout.write(celldDevNodeId(resolveProjectDir(options.project)) + '\n')
			return
		}
		case 'deploy': {
			if (!options.state) throw new Error('--state is required')
			if (!options.port) throw new Error('--port is required')
			const { database } = await deployLocal(options)
			const index = ensureMetadataIndex(database)
			if (index.created) {
				process.stderr.write(
					`[kody-celld] single deploy: indexed ${database} for metadata listings in ${index.elapsedMs}ms (#179)\n`,
				)
			}
			reportLtxGc(database, { dryRun: false })
			return
		}
		case 'ltx-gc': {
			if (!options.state) throw new Error('--state is required')
			reportLtxGc(objectsDbPath(options.state), { dryRun: options.dryRun, online: options.online })
			return
		}
		case 'ltx-gc-loop': {
			if (!options.state) throw new Error('--state is required')
			await ltxGcLoop(objectsDbPath(options.state))
			return
		}
		default:
			throw new Error(
				`usage: single-local.mjs deploy|node-env|node-id|ltx-gc|ltx-gc-loop --project DIR --state DIR [--port N] [--host IP] [--dry-run] [--online] [-- celld.dev flags]`,
			)
	}
}

const isMain =
	Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isMain) {
	main(process.argv.slice(2)).catch((error) => {
		process.stderr.write(`[kody-celld] ${error?.stack || error}\n`)
		process.exit(1)
	})
}
