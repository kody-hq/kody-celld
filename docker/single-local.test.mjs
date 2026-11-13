// Unit coverage for the single-node deploy/node helpers used by
// docker/entrypoint.sh. Integration coverage is the CI smoke job.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, it } from 'node:test'
import {
	celldDevNodeId,
	ensureMetadataIndex,
	METADATA_INDEX,
	objectsDbPath,
	readDeployPointerEtag,
	resolveProjectDir,
} from './single-local.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'kody-single-local-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

describe('single-local helpers', () => {
	it('celldDevNodeId matches celld.dev (sha256 of project path, first 12 hex)', () => {
		const project = '/app'
		const expected = 'dev-' + createHash('sha256').update(Buffer.from(project)).digest('hex').slice(0, 12)
		assert.equal(celldDevNodeId(project), expected)
		assert.match(celldDevNodeId('/tmp/tiny-worker'), /^dev-[0-9a-f]{12}$/)
	})

	it('resolveProjectDir follows the Wrangler config parent', () => {
		const project = join(scratch, 'proj')
		mkdirSync(project, { recursive: true })
		writeFileSync(join(project, 'wrangler.jsonc'), '{ "name": "x", "main": "i.js" }\n')
		writeFileSync(join(project, 'i.js'), 'export default {}\n')
		assert.equal(resolveProjectDir(project), realpathSync(project))
	})

	it('resolveProjectDir fails loudly when no Wrangler config exists', () => {
		const empty = join(scratch, 'empty')
		mkdirSync(empty, { recursive: true })
		assert.throws(() => resolveProjectDir(empty), /no Wrangler config/)
	})

	it('readDeployPointerEtag returns null for a missing store and the etag after a write', () => {
		const state = join(scratch, 'state')
		mkdirSync(state, { recursive: true })
		const database = objectsDbPath(state)
		assert.equal(readDeployPointerEtag(database), null)

		const db = new DatabaseSync(database)
		db.exec(`
			CREATE TABLE objects (
				key TEXT PRIMARY KEY,
				body BLOB NOT NULL,
				etag INTEGER NOT NULL,
				modified_ms INTEGER NOT NULL,
				attributes TEXT NOT NULL
			);
		`)
		db.prepare('INSERT INTO objects(key, body, etag, modified_ms, attributes) VALUES (?, ?, ?, ?, ?)').run(
			'deploy/current.json',
			Buffer.from('{}'),
			42,
			Date.now(),
			'[]',
		)
		db.close()

		assert.equal(readDeployPointerEtag(database), 42)
	})

	it('readDeployPointerEtag returns null when the objects table is missing', () => {
		const state = join(scratch, 'empty-db')
		mkdirSync(state, { recursive: true })
		const database = objectsDbPath(state)
		const db = new DatabaseSync(database)
		db.exec('CREATE TABLE unrelated (id INTEGER)')
		db.close()
		assert.equal(readDeployPointerEtag(database), null)
	})

	it('ensureMetadataIndex serves celld listings from the index, idempotently', () => {
		const state = join(scratch, 'indexed')
		mkdirSync(state, { recursive: true })
		const database = objectsDbPath(state)
		const db = new DatabaseSync(database)
		db.exec(`
			CREATE TABLE objects (
				key TEXT PRIMARY KEY,
				body BLOB NOT NULL,
				etag INTEGER NOT NULL,
				modified_ms INTEGER NOT NULL,
				attributes TEXT NOT NULL
			);
		`)
		db.prepare('INSERT INTO objects VALUES (?, ?, ?, ?, ?)').run(
			'cells/a/ltx/e1/0000/1.ltx',
			Buffer.alloc(9000),
			1,
			0,
			'[]',
		)
		db.close()

		assert.equal(ensureMetadataIndex(database).created, true)
		assert.deepEqual(ensureMetadataIndex(database), { created: false, elapsedMs: 0 })

		const check = new DatabaseSync(database, { readOnly: true })
		// The exact statement celld 0.6 LocalStore::metadata runs for every listing.
		const listing =
			"SELECT key, CAST(X'' AS BLOB), etag, modified_ms, attributes, length(body) FROM objects ORDER BY key"
		const plan = check.prepare(`EXPLAIN QUERY PLAN ${listing}`).all()
		assert.deepEqual(
			plan.map((row) => row.detail),
			[`SCAN objects USING COVERING INDEX ${METADATA_INDEX}`],
		)
		assert.deepEqual(check.prepare(listing).all()[0].key, 'cells/a/ltx/e1/0000/1.ltx')
		check.close()
	})

	it('ensureMetadataIndex fails loudly when the celld store schema changes', () => {
		const state = join(scratch, 'drifted')
		mkdirSync(state, { recursive: true })
		const database = objectsDbPath(state)
		const db = new DatabaseSync(database)
		db.exec('CREATE TABLE objects (key TEXT PRIMARY KEY, body BLOB NOT NULL)')
		db.close()
		assert.throws(() => ensureMetadataIndex(database), /celld changed its local store schema/)
	})

	it('ensureMetadataIndex fails loudly when objects_metadata has a different shape', () => {
		const state = join(scratch, 'other-index')
		mkdirSync(state, { recursive: true })
		const database = objectsDbPath(state)
		const db = new DatabaseSync(database)
		db.exec(`
			CREATE TABLE objects (key TEXT PRIMARY KEY, body BLOB NOT NULL, etag INTEGER NOT NULL, modified_ms INTEGER NOT NULL, attributes TEXT NOT NULL);
			CREATE INDEX objects_metadata ON objects(key, etag);
		`)
		db.close()
		assert.throws(() => ensureMetadataIndex(database), /covers \[key, etag\]/)
	})

	it('ensureMetadataIndex fails loudly when the store has no objects table', () => {
		const state = join(scratch, 'no-objects')
		mkdirSync(state, { recursive: true })
		assert.throws(() => ensureMetadataIndex(objectsDbPath(state)), /objects table has columns \[\]/)
	})

	it('entrypoint runs deploy then execs the direct node (no long-lived celld.dev)', () => {
		const body = readFileSync(new URL('./entrypoint.sh', import.meta.url), 'utf8')
		assert.match(body, /single-local\.mjs deploy/)
		assert.match(body, /--no-control-plane/)
		assert.match(body, /CELLD_INTERNAL_DEV_STORE/)
		assert.match(body, /bucket celld-dev/)
		assert.doesNotMatch(body, /exec celld dev /)
	})

	it('entrypoint defaults CELLD_LTX_RETENTION_SECS for single-mode epoch GC', () => {
		const body = readFileSync(new URL('./entrypoint.sh', import.meta.url), 'utf8')
		assert.match(body, /CELLD_LTX_RETENTION_SECS=86400/)
		// Empty compose values are unset before celld sees them ("" is not a u64).
		assert.match(body, /unset CELLD_LTX_RETENTION_SECS/)
		// Default only when the variable is absent; 0 must remain 0 (opt out).
		assert.match(body, /-z "\$\{CELLD_LTX_RETENTION_SECS\+x\}"/)
		// Epoch GC maintenance requires fleet durability (celld default).
		assert.match(body, /CELLD_DURABILITY=fleet/)
		assert.match(body, /bucket durability never runs epoch GC/)
	})
})
