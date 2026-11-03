import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { KodyError } from '../lib/errors.ts'
import {
	assertPackageFileSizes,
	assertPackageTotalBytes,
	countPackageFiles,
	deletePackageFiles,
	maxPackageFileBytes,
	maxPackageTotalBytes,
	migrateCommunityPackageFiles,
	migrateUserPackageFiles,
	packageFilesSchema,
	normalizePackageFiles,
	readPackageFileBytes,
	readPackageFiles,
	readUserPackageRow,
	replacePackageFiles,
	userPackagesTableDdl,
} from './package-files-store.ts'

/** Just enough of Durable Object `SqlStorage` for the store. */
function memorySql() {
	const db = new DatabaseSync(':memory:')
	return {
		exec(query: string, ...params: Array<string | number | null>) {
			const statements = query.split(';').filter((s) => s.trim())
			if (statements.length > 1) {
				for (const statement of statements) db.exec(statement)
				return { toArray: () => [], rowsWritten: 0 }
			}
			const statement = db.prepare(query)
			if (/^\s*select/i.test(query)) return { toArray: () => statement.all(...params), rowsWritten: 0 }
			const result = statement.run(...params)
			return { toArray: () => [], rowsWritten: Number(result.changes) }
		},
	} as unknown as SqlStorage
}

function columnsOf(sql: SqlStorage, table: string): Array<string> {
	return sql
		.exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
		.toArray()
		.map((row) => row.name)
}

describe('package-files-store', () => {
	it('replaces, reads, counts and deletes per-file rows', () => {
		const sql = memorySql()
		sql.exec(packageFilesSchema)
		replacePackageFiles(sql, '@a/pkg', { 'a.js': 'one', 'b.js': 'two' })
		assert.deepEqual(readPackageFiles(sql, '@a/pkg'), { 'a.js': 'one', 'b.js': 'two' })
		assert.equal(countPackageFiles(sql, '@a/pkg'), 2)
		replacePackageFiles(sql, '@a/pkg', { 'c.js': 'three' })
		assert.deepEqual(readPackageFiles(sql, '@a/pkg'), { 'c.js': 'three' })
		assert.equal(countPackageFiles(sql, '@a/pkg'), 1)
		deletePackageFiles(sql, '@a/pkg')
		assert.deepEqual(readPackageFiles(sql, '@a/pkg'), {})
		assert.equal(countPackageFiles(sql, '@a/pkg'), 0)
	})

	it('migrates user packages off files_json and refuses a second dual-read path', () => {
		const sql = memorySql()
		sql.exec(`
			CREATE TABLE packages (
				name TEXT PRIMARY KEY,
				version TEXT NOT NULL,
				manifest_json TEXT NOT NULL,
				files_json TEXT NOT NULL,
				source TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`)
		sql.exec(
			`INSERT INTO packages (name, version, manifest_json, files_json, source, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			'@a/old',
			'1.0.0',
			'{"name":"@a/old","version":"1.0.0"}',
			JSON.stringify({ 'package.json': '{"name":"@a/old"}', 'README.md': '# old' }),
			'local',
			'2024-01-01T00:00:00.000Z',
			'2024-01-02T00:00:00.000Z',
		)
		migrateUserPackageFiles(sql)
		assert.ok(!columnsOf(sql, 'packages').includes('files_json'))
		assert.deepEqual(readPackageFiles(sql, '@a/old'), {
			'package.json': '{"name":"@a/old"}',
			'README.md': '# old',
		})
		const row = sql
			.exec<{ name: string; version: string; source: string }>(
				'SELECT name, version, source FROM packages WHERE name = ?',
				'@a/old',
			)
			.toArray()[0]
		assert.equal(row?.name, '@a/old')
		assert.equal(row?.version, '1.0.0')
		assert.equal(row?.source, 'local')
		// Idempotent: running again leaves the post-migration shape alone.
		migrateUserPackageFiles(sql)
		assert.ok(!columnsOf(sql, 'packages').includes('files_json'))
		assert.deepEqual(readPackageFiles(sql, '@a/old'), {
			'package.json': '{"name":"@a/old"}',
			'README.md': '# old',
		})
	})

	it('migrates community packages and rebuilds indexes', () => {
		const sql = memorySql()
		sql.exec(`
			CREATE TABLE community_packages (
				name TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				publisher TEXT NOT NULL,
				version TEXT NOT NULL,
				description TEXT NOT NULL,
				keywords TEXT NOT NULL,
				manifest_json TEXT NOT NULL,
				files_json TEXT NOT NULL,
				installs INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`)
		sql.exec(
			`INSERT INTO community_packages
				(name, user_id, publisher, version, description, keywords, manifest_json, files_json, installs, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 3, ?, ?)`,
			'@a/pub',
			'alice',
			'alice',
			'1.0.0',
			'desc',
			'kw',
			'{}',
			JSON.stringify({ 'README.md': '# pub', 'AGENTS.md': 'agents' }),
			'2024-01-01T00:00:00.000Z',
			'2024-01-02T00:00:00.000Z',
		)
		migrateCommunityPackageFiles(sql)
		assert.ok(!columnsOf(sql, 'community_packages').includes('files_json'))
		assert.deepEqual(readPackageFiles(sql, '@a/pub'), { 'README.md': '# pub', 'AGENTS.md': 'agents' })
		assert.equal(
			sql.exec<{ installs: number }>('SELECT installs FROM community_packages WHERE name = ?', '@a/pub').toArray()[0]
				?.installs,
			3,
		)
	})

	it('fails loudly on corrupt files_json during migration', () => {
		const sql = memorySql()
		sql.exec(`
			CREATE TABLE packages (
				name TEXT PRIMARY KEY,
				version TEXT NOT NULL,
				manifest_json TEXT NOT NULL,
				files_json TEXT NOT NULL,
				source TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`)
		sql.exec(
			`INSERT INTO packages (name, version, manifest_json, files_json, source, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			'@a/bad',
			'1.0.0',
			'{}',
			'{not-json',
			'local',
			'2024-01-01T00:00:00.000Z',
			'2024-01-01T00:00:00.000Z',
		)
		assert.throws(
			() => migrateUserPackageFiles(sql),
			(error: unknown) => {
				assert.ok(error instanceof KodyError)
				assert.match(error.message, /Corrupt files_json for package "@a\/bad"/)
				return true
			},
		)
	})

	it('fresh schema has no files_json and migration is a no-op', () => {
		const sql = memorySql()
		sql.exec(userPackagesTableDdl)
		sql.exec(packageFilesSchema)
		migrateUserPackageFiles(sql)
		assert.ok(!columnsOf(sql, 'packages').includes('files_json'))
		assert.deepEqual(columnsOf(sql, 'package_files').sort(), ['bytes', 'content', 'package_name', 'path'])
	})

	it('assertPackageTotalBytes names the 4 MiB limit', () => {
		assertPackageTotalBytes(maxPackageTotalBytes)
		assert.throws(
			() => assertPackageTotalBytes(maxPackageTotalBytes + 1),
			(error: unknown) => {
				assert.ok(error instanceof KodyError)
				assert.equal(error.code, 'invalid_package')
				assert.match(error.message, /at most 4 MiB/)
				assert.match(error.message, /limit is 4 MiB/)
				return true
			},
		)
	})

	it('assertPackageFileSizes refuses a single file over the SQLite bind cap', () => {
		assertPackageFileSizes({ 'ok.txt': 'x'.repeat(maxPackageFileBytes) })
		assert.throws(
			() => assertPackageFileSizes({ 'huge.txt': 'x'.repeat(maxPackageFileBytes + 1) }),
			(error: unknown) => {
				assert.ok(error instanceof KodyError)
				assert.equal(error.code, 'invalid_package')
				assert.match(error.message, /File "huge\.txt"/)
				assert.match(error.message, /Durable Object SQLite bind limit/)
				return true
			},
		)
	})
})

/** Every byte value, so a lossy text round trip (UTF-8, windows-1252) shows up. */
const pngBytes = Uint8Array.from([
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
	0x00,
	...Array.from({ length: 256 }, (_, i) => i),
])
const pngFile = { base64: Buffer.from(pngBytes).toString('base64') }

describe('binary package files', () => {
	it('stores a binary file as bytes and reads it back byte-identical, text files unchanged', () => {
		const sql = memorySql()
		sql.exec(packageFilesSchema)
		replacePackageFiles(sql, '@a/pkg', { 'main.js': 'export default 1', 'public/logo.png': pngFile })
		const files = readPackageFiles(sql, '@a/pkg')
		assert.equal(files['main.js'], 'export default 1')
		assert.deepEqual(files['public/logo.png'], pngFile)
		const row = sql
			.exec<{ content: string; bytes: ArrayBuffer | null }>(
				"SELECT content, bytes FROM package_files WHERE path = 'public/logo.png'",
			)
			.toArray()[0]
		assert.equal(row?.content, '')
		assert.deepEqual(new Uint8Array(row!.bytes!), pngBytes)
		const text = sql
			.exec<{ bytes: ArrayBuffer | null }>("SELECT bytes FROM package_files WHERE path = 'main.js'")
			.toArray()[0]
		assert.equal(text?.bytes, null)
		assert.deepEqual(readPackageFileBytes(sql, '@a/pkg', 'public/logo.png'), pngBytes)
		assert.deepEqual(readPackageFileBytes(sql, '@a/pkg', 'main.js'), new TextEncoder().encode('export default 1'))
		assert.equal(readPackageFileBytes(sql, '@a/pkg', 'nope.png'), null)
	})

	it('adds the bytes column to an existing package_files table and keeps its rows', () => {
		const sql = memorySql()
		sql.exec(userPackagesTableDdl)
		sql.exec(`
			CREATE TABLE package_files (
				package_name TEXT NOT NULL,
				path TEXT NOT NULL,
				content TEXT NOT NULL,
				PRIMARY KEY (package_name, path)
			);
		`)
		sql.exec('INSERT INTO package_files (package_name, path, content) VALUES (?, ?, ?)', '@a/old', 'README.md', '# old')
		migrateUserPackageFiles(sql)
		assert.deepEqual(columnsOf(sql, 'package_files').sort(), ['bytes', 'content', 'package_name', 'path'])
		assert.deepEqual(readPackageFiles(sql, '@a/old'), { 'README.md': '# old' })
		migrateUserPackageFiles(sql)
		migrateCommunityPackageFiles(sql)
		assert.deepEqual(readPackageFiles(sql, '@a/old'), { 'README.md': '# old' })
	})

	it('a row holds exactly one of text content or binary bytes (CHECK), fresh and migrated tables alike', () => {
		const legacy = memorySql()
		legacy.exec(userPackagesTableDdl)
		legacy.exec(`
			CREATE TABLE package_files (
				package_name TEXT NOT NULL,
				path TEXT NOT NULL,
				content TEXT NOT NULL,
				PRIMARY KEY (package_name, path)
			);
		`)
		migrateUserPackageFiles(legacy)
		const fresh = memorySql()
		fresh.exec(packageFilesSchema)
		for (const sql of [fresh, legacy]) {
			const insert = (path: string, content: string, bytes: Uint8Array | string | null) =>
				sql.exec(
					'INSERT INTO package_files (package_name, path, content, bytes) VALUES (?, ?, ?, ?)',
					'@a/pkg',
					path,
					content,
					bytes,
				)
			insert('text.txt', 'hello', null)
			insert('empty.txt', '', null)
			insert('logo.png', '', pngBytes)
			assert.throws(() => insert('both.png', 'text', pngBytes), /CHECK constraint failed/)
			assert.throws(() => insert('empty.png', '', new Uint8Array()), /CHECK constraint failed/)
			assert.throws(() => insert('string.png', '', 'not a blob'), /CHECK constraint failed/)
		}
	})

	it('treats an empty { base64 } as an empty text file (a binary row always has bytes)', () => {
		const sql = memorySql()
		sql.exec(packageFilesSchema)
		replacePackageFiles(sql, '@a/pkg', normalizePackageFiles({ 'public/empty.bin': { base64: '' } }))
		assert.deepEqual(readPackageFiles(sql, '@a/pkg'), { 'public/empty.bin': '' })
	})

	it('counts decoded bytes of binary files against the per-file and total caps', () => {
		const exact = { base64: Buffer.alloc(maxPackageFileBytes).toString('base64') }
		assertPackageFileSizes({ 'big.bin': exact })
		assert.throws(
			() =>
				assertPackageFileSizes({ 'huge.bin': { base64: Buffer.alloc(maxPackageFileBytes + 1).toString('base64') } }),
			/File "huge\.bin" is .*each package file must be at most/,
		)
		const third = { base64: Buffer.alloc(1_500_000).toString('base64') }
		assert.throws(() => assertPackageFileSizes({ 'a.bin': third, 'b.bin': third, 'c.bin': third }), /at most 4 MiB/)
	})
})

describe('normalizePackageFiles', () => {
	it('strips ./ and keeps text and { base64 } entries, refusing anything else', () => {
		assert.deepEqual(normalizePackageFiles({ './main.js': 'x', 'public/logo.png': pngFile }), {
			'main.js': 'x',
			'public/logo.png': pngFile,
		})
		assert.throws(() => normalizePackageFiles({ 'a.txt': 1 }), /must be a string, or \{ base64 \}/)
		assert.throws(() => normalizePackageFiles({ './README.md': pngFile }), /"README\.md" must be UTF-8 text/)
	})
})

describe('readUserPackageRow', () => {
	it('reads the package row without touching package_files', () => {
		const sql = memorySql()
		sql.exec(packageFilesSchema)
		sql.exec(userPackagesTableDdl)
		sql.exec(
			'INSERT INTO packages (name, version, manifest_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
			'@a/app',
			'1.2.3',
			'{"name":"@a/app","version":"1.2.3"}',
			'test',
			'2026-01-01T00:00:00.000Z',
			'2026-01-02T00:00:00.000Z',
		)
		replacePackageFiles(sql, '@a/app', { 'index.js': 'export default 1' })
		const queries: Array<string> = []
		const recording = {
			exec(query: string, ...params: Array<string | number | null>) {
				queries.push(query)
				return sql.exec(query, ...params)
			},
		} as unknown as SqlStorage
		assert.deepEqual(readUserPackageRow(recording, '@a/app'), {
			name: '@a/app',
			version: '1.2.3',
			manifestJson: '{"name":"@a/app","version":"1.2.3"}',
			source: 'test',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
		})
		assert.equal(readUserPackageRow(recording, '@a/missing'), null)
		assert.ok(queries.length > 0)
		assert.ok(queries.every((query) => !/package_files/.test(query)))
	})
})
