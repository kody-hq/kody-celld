import { KodyError } from '../lib/errors.ts'
import type { PackageFiles } from './manifest.ts'
import {
	binaryPackageFile,
	isBinaryPackageFile,
	packageFileBytes,
	packageFileSize,
	readPackageFileInput,
} from './package-file-content.ts'

/** Documented packageSave / install total size cap. */
export const maxPackageTotalBytes = 4 * 1024 * 1024

/**
 * Per-file cap. Durable Object / celld SQLite rejects a single TEXT/BLOB bind
 * near 2 MiB (`string or blob too big`); same headroom as `npmCacheMaxModuleBytes`.
 */
export const maxPackageFileBytes = 1_800_000

/**
 * A text file is `content` with `bytes` NULL; a binary file (#85) is `content`
 * '' with its raw bytes in `bytes`. An image without the column (before #85)
 * reads binary files as empty text and keeps every text file.
 */
export const packageFilesSchema = `
	CREATE TABLE IF NOT EXISTS package_files (
		package_name TEXT NOT NULL,
		path TEXT NOT NULL,
		content TEXT NOT NULL,
		bytes BLOB,
		PRIMARY KEY (package_name, path)
	);
`

/** Additive: tables created before #85 gain the nullable `bytes` column; existing rows stay text. */
function ensurePackageFilesBytesColumn(sql: SqlStorage) {
	sql.exec(packageFilesSchema)
	const columns = sql
		.exec<{ name: string }>(`SELECT name FROM pragma_table_info('package_files')`)
		.toArray()
		.map((row) => row.name)
	if (!columns.includes('bytes')) sql.exec('ALTER TABLE package_files ADD COLUMN bytes BLOB')
}

/** UserCell `packages` table after the files_json → package_files migration. */
export const userPackagesTableDdl = `
	CREATE TABLE IF NOT EXISTS packages (
		name TEXT PRIMARY KEY,
		version TEXT NOT NULL,
		manifest_json TEXT NOT NULL,
		source TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
`

/** RegistryCell `community_packages` table after the same migration. */
export const communityPackagesTableDdl = `
	CREATE TABLE IF NOT EXISTS community_packages (
		name TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		publisher TEXT NOT NULL,
		version TEXT NOT NULL,
		description TEXT NOT NULL,
		keywords TEXT NOT NULL,
		manifest_json TEXT NOT NULL,
		installs INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
`

export const communityPackagesIndexesDdl = `
	CREATE INDEX IF NOT EXISTS community_packages_user ON community_packages(user_id);
	CREATE INDEX IF NOT EXISTS community_packages_installs ON community_packages(installs DESC, updated_at DESC);
`

/**
 * One-time migration: move each package's `files_json` blob into per-file
 * `package_files` rows, then rebuild the parent table without that column.
 * Idempotent — a second call is a no-op once `files_json` is gone.
 * Corrupt `files_json` fails loudly; there is no dual-read fallback.
 */
export function migrateUserPackageFiles(sql: SqlStorage) {
	ensurePackageFilesBytesColumn(sql)
	dropFilesJsonColumn(sql, {
		table: 'packages',
		keepColumns: ['name', 'version', 'manifest_json', 'source', 'created_at', 'updated_at'],
		createWithoutFilesJson: `
			CREATE TABLE packages__nofiles (
				name TEXT PRIMARY KEY,
				version TEXT NOT NULL,
				manifest_json TEXT NOT NULL,
				source TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`,
	})
}

export function migrateCommunityPackageFiles(sql: SqlStorage) {
	ensurePackageFilesBytesColumn(sql)
	dropFilesJsonColumn(sql, {
		table: 'community_packages',
		keepColumns: [
			'name',
			'user_id',
			'publisher',
			'version',
			'description',
			'keywords',
			'manifest_json',
			'installs',
			'created_at',
			'updated_at',
		],
		createWithoutFilesJson: `
			CREATE TABLE community_packages__nofiles (
				name TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				publisher TEXT NOT NULL,
				version TEXT NOT NULL,
				description TEXT NOT NULL,
				keywords TEXT NOT NULL,
				manifest_json TEXT NOT NULL,
				installs INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`,
		afterRename: () => {
			sql.exec(communityPackagesIndexesDdl)
		},
	})
}

function dropFilesJsonColumn(
	sql: SqlStorage,
	meta: {
		table: 'packages' | 'community_packages'
		keepColumns: ReadonlyArray<string>
		createWithoutFilesJson: string
		afterRename?: () => void
	},
) {
	const columns = sql
		.exec<{ name: string }>(`SELECT name FROM pragma_table_info('${meta.table}')`)
		.toArray()
		.map((row) => row.name)
	if (columns.length === 0) return
	if (!columns.includes('files_json')) return
	for (const name of meta.keepColumns) {
		if (!columns.includes(name)) {
			throw new KodyError('internal_error', `${meta.table} is missing column "${name}" for package-files migration.`, {
				status: 500,
			})
		}
	}

	const rows = sql.exec<{ name: string; files_json: string }>(`SELECT name, files_json FROM ${meta.table}`).toArray()
	for (const row of rows) {
		replacePackageFiles(sql, row.name, parseFilesJson(row.name, row.files_json))
	}

	const staging = `${meta.table}__nofiles`
	const keepList = meta.keepColumns.join(', ')
	sql.exec(`DROP TABLE IF EXISTS ${staging}`)
	sql.exec(meta.createWithoutFilesJson)
	sql.exec(`INSERT INTO ${staging} (${keepList}) SELECT ${keepList} FROM ${meta.table}`)
	sql.exec(`DROP TABLE ${meta.table}`)
	sql.exec(`ALTER TABLE ${staging} RENAME TO ${meta.table}`)
	meta.afterRename?.()
}

function parseFilesJson(packageName: string, filesJson: string): PackageFiles {
	let parsed: unknown
	try {
		parsed = JSON.parse(filesJson)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new KodyError(
			'internal_error',
			`Corrupt files_json for package "${packageName}" during migration: ${detail}`,
			{ status: 500 },
		)
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new KodyError(
			'internal_error',
			`Corrupt files_json for package "${packageName}" during migration: expected a path→content object.`,
			{ status: 500 },
		)
	}
	const files: PackageFiles = {}
	for (const [path, content] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof content !== 'string') {
			throw new KodyError(
				'internal_error',
				`Corrupt files_json for package "${packageName}": file "${path}" is not a string.`,
				{ status: 500 },
			)
		}
		files[path] = content
	}
	return files
}

/** Enforce the documented 4 MiB total. */
export function assertPackageTotalBytes(totalBytes: number) {
	if (totalBytes > maxPackageTotalBytes) {
		throw new KodyError(
			'invalid_package',
			`Package files must total at most 4 MiB (got ${formatMiB(totalBytes)}; limit is 4 MiB).`,
		)
	}
}

/**
 * A packageSave file map as given (strings, or `{ base64 }` for binary files)
 * with leading `./` stripped; see `readPackageFileInput`.
 */
export function normalizePackageFiles(input: Record<string, unknown> | undefined): PackageFiles {
	const files: PackageFiles = {}
	for (const [path, content] of Object.entries(input ?? {})) {
		const clean = path.replace(/^\.\//, '')
		files[clean] = readPackageFileInput(clean, content)
	}
	return files
}

/**
 * Enforce per-file and total size caps before any SQLite bind: string length
 * for text files, decoded bytes for binary files.
 * Per-file failures name the path and the ~1.8 MiB celld bind limit.
 */
export function assertPackageFileSizes(files: PackageFiles) {
	let totalBytes = 0
	for (const [path, content] of Object.entries(files)) {
		const size = packageFileSize(readPackageFileInput(path, content))
		if (size > maxPackageFileBytes) {
			throw new KodyError(
				'invalid_package',
				`File "${path}" is ${formatMiB(size)}; each package file must be at most ${formatMiB(maxPackageFileBytes)} (Durable Object SQLite bind limit).`,
			)
		}
		totalBytes += size
	}
	assertPackageTotalBytes(totalBytes)
}

function formatMiB(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
	return `${Math.round(bytes / 1024)} KiB`
}

/** Replace every file row for a package (delete-then-insert). */
export function replacePackageFiles(sql: SqlStorage, packageName: string, files: PackageFiles) {
	sql.exec('DELETE FROM package_files WHERE package_name = ?', packageName)
	for (const [path, content] of Object.entries(files)) {
		if (isBinaryPackageFile(content)) {
			sql.exec(
				'INSERT INTO package_files (package_name, path, content, bytes) VALUES (?, ?, ?, ?)',
				packageName,
				path,
				'',
				packageFileBytes(content),
			)
		} else {
			sql.exec('INSERT INTO package_files (package_name, path, content) VALUES (?, ?, ?)', packageName, path, content)
		}
	}
}

/** A UserCell `packages` row without its files: the metadata-only read package apps use per request. */
export type UserPackageRow = {
	name: string
	version: string
	manifestJson: string
	source: string
	createdAt: string
	updatedAt: string
}

export function readUserPackageRow(sql: SqlStorage, packageName: string): UserPackageRow | null {
	const row = sql
		.exec<{
			name: string
			version: string
			manifest_json: string
			source: string
			created_at: string
			updated_at: string
		}>('SELECT name, version, manifest_json, source, created_at, updated_at FROM packages WHERE name = ?', packageName)
		.toArray()[0]
	if (!row) return null
	return {
		name: row.name,
		version: row.version,
		manifestJson: row.manifest_json,
		source: row.source,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

/** `bytes` is an ArrayBuffer on celld (node:sqlite in tests hands back a Uint8Array). */
type PackageFileRow = { path: string; content: string; bytes: ArrayBuffer | null }

function rowContent(packageName: string, row: PackageFileRow) {
	if (row.bytes !== null && row.bytes !== undefined) return new Uint8Array(row.bytes)
	if (typeof row.content !== 'string') {
		throw new KodyError('internal_error', `Corrupt package_files row for "${packageName}" at "${row.path}".`, {
			status: 500,
		})
	}
	return row.content
}

export function readPackageFiles(sql: SqlStorage, packageName: string): PackageFiles {
	const rows = sql
		.exec<PackageFileRow>(
			'SELECT path, content, bytes FROM package_files WHERE package_name = ? ORDER BY path',
			packageName,
		)
		.toArray()
	const files: PackageFiles = {}
	for (const row of rows) {
		const content = rowContent(packageName, row)
		files[row.path] = typeof content === 'string' ? content : binaryPackageFile(content)
	}
	return files
}

/** One file as the bytes it is served as (UTF-8 for text), or null; `/_assets/*` reads only this. */
export function readPackageFileBytes(sql: SqlStorage, packageName: string, path: string): Uint8Array | null {
	const row = sql
		.exec<PackageFileRow>(
			'SELECT path, content, bytes FROM package_files WHERE package_name = ? AND path = ?',
			packageName,
			path,
		)
		.toArray()[0]
	if (!row) return null
	const content = rowContent(packageName, row)
	return typeof content === 'string' ? new TextEncoder().encode(content) : content
}

export function countPackageFiles(sql: SqlStorage, packageName: string): number {
	return (
		sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM package_files WHERE package_name = ?', packageName).toArray()[0]
			?.n ?? 0
	)
}

export function deletePackageFiles(sql: SqlStorage, packageName: string) {
	sql.exec('DELETE FROM package_files WHERE package_name = ?', packageName)
}
