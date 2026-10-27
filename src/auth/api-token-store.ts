import { formatApiToken, generateApiTokenId, generateApiTokenSecret, parseApiToken } from '../lib/api-token-format.ts'
import { sha256Hex } from '../lib/crypto.ts'
import { KodyError } from '../lib/errors.ts'

export const apiTokenPolicy = {
	minIdleTtlSeconds: 60,
	maxIdleTtlSeconds: 14 * 24 * 60 * 60,
	maxMaxLifetimeSeconds: 90 * 24 * 60 * 60,
	maxActiveTokensPerUser: 500,
	maxNameLength: 100,
} as const

export const apiTokenLifetimeAliases = {
	short: { idleTtlSeconds: 60 * 60, maxLifetimeSeconds: 24 * 60 * 60 },
	long: {
		idleTtlSeconds: apiTokenPolicy.maxIdleTtlSeconds,
		maxLifetimeSeconds: apiTokenPolicy.maxMaxLifetimeSeconds,
	},
} as const

export const orgPermissionScopes = [
	...Object.entries({
		package: ['read', 'execute', 'write', 'delete', 'publish', 'manage_access'],
		app: ['read', 'execute', 'write', 'delete', 'manage_access'],
		job: ['read', 'execute', 'write', 'delete', 'manage_access'],
		secret: ['use', 'read', 'write', 'delete', 'manage_access'],
		integration: ['use', 'read', 'write', 'delete', 'manage_access'],
		memory: ['read', 'write', 'delete', 'manage_access'],
		email: ['read', 'send', 'write', 'delete', 'manage_access'],
	}).flatMap(([resource, actions]) => actions.map((action) => `${resource}:${action}`)),
	...['package', 'app', 'job', 'secret', 'integration', 'memory', 'email'].map((resource) => `${resource}:create`),
	'org:read',
	'org:write',
	'org:delete',
	'org:execute',
	'search:read',
	'member:read',
	'member:write',
	'member:delete',
	'team:read',
	'team:write',
	'team:delete',
	'billing:read',
	'billing:write',
	'audit:read',
	'token:read',
	'token:delete',
] as const
const orgPermissionScopeSet = new Set<string>(orgPermissionScopes)

export const apiTokenSchema = `
	CREATE TABLE IF NOT EXISTS api_tokens (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		name TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		scopes_json TEXT NOT NULL,
		idle_ttl_seconds INTEGER NOT NULL,
		expires_at TEXT NOT NULL,
		max_expires_at TEXT NOT NULL,
		created_via TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		last_used_at TEXT,
		rotated_at TEXT,
		revoked_at TEXT
	);
	CREATE INDEX IF NOT EXISTS api_tokens_user_created ON api_tokens(user_id, created_at);
`

export type ApiTokenRecord = {
	id: string
	user_id: string
	name: string
	token_hash: string
	scopes: Array<string>
	idle_ttl_seconds: number
	expires_at: string
	max_expires_at: string
	created_via: string
	created_at: string
	updated_at: string
	last_used_at: string | null
	rotated_at: string | null
	revoked_at: string | null
}

export type ApiTokenView = Omit<ApiTokenRecord, 'user_id' | 'token_hash' | 'updated_at'> & {
	org_id: string
	org_binding: 'user'
	status: 'active' | 'expired' | 'revoked'
	profile_name: null
}

export type ApiTokenSecretView = ApiTokenView & {
	token: string
	token_type: 'Bearer'
}

export type ApiTokenLifetimeInput = {
	lifetime?: string | null
	idleTtlSeconds?: number
	maxLifetimeSeconds?: number
	missingError?: string
}

export function resolveApiTokenLifetime(input: ApiTokenLifetimeInput) {
	const aliasRaw = typeof input.lifetime === 'string' ? input.lifetime.trim() : ''
	const hasAlias = aliasRaw.length > 0
	const hasIdle = input.idleTtlSeconds !== undefined
	const hasMax = input.maxLifetimeSeconds !== undefined
	if (!hasAlias && !hasIdle && !hasMax) {
		throw new KodyError(
			'invalid_request',
			input.missingError ??
				'Token lifetime is required. Pass lifetime: "short"|"long", or both idle_ttl_seconds and max_lifetime_seconds ' +
					`(idle ${apiTokenPolicy.minIdleTtlSeconds}-${apiTokenPolicy.maxIdleTtlSeconds}, max age up to ${apiTokenPolicy.maxMaxLifetimeSeconds}). ` +
					'Single-task agents should use lifetime: "short".',
		)
	}
	if (hasAlias && (hasIdle || hasMax)) {
		throw new KodyError(
			'invalid_request',
			'Pass lifetime: "short"|"long", or both idle_ttl_seconds and max_lifetime_seconds, not both forms.',
		)
	}
	if (hasAlias) {
		if (!Object.hasOwn(apiTokenLifetimeAliases, aliasRaw)) {
			throw new KodyError('invalid_request', `lifetime must be "short" or "long" (got ${JSON.stringify(aliasRaw)}).`)
		}
		return apiTokenLifetimeAliases[aliasRaw as keyof typeof apiTokenLifetimeAliases]
	}
	if (!hasIdle || !hasMax) {
		throw new KodyError(
			'invalid_request',
			'When not using lifetime: "short"|"long", both idle_ttl_seconds and max_lifetime_seconds are required.',
		)
	}
	const readInteger = (value: number, min: number, max: number, field: string) => {
		if (!Number.isInteger(value) || value < min || value > max) {
			throw new KodyError('invalid_request', `${field} must be an integer between ${min} and ${max}.`)
		}
		return value
	}
	const idleTtlSeconds = readInteger(
		input.idleTtlSeconds!,
		apiTokenPolicy.minIdleTtlSeconds,
		apiTokenPolicy.maxIdleTtlSeconds,
		'idle_ttl_seconds',
	)
	const maxLifetimeSeconds = readInteger(
		input.maxLifetimeSeconds!,
		idleTtlSeconds,
		apiTokenPolicy.maxMaxLifetimeSeconds,
		'max_lifetime_seconds',
	)
	return { idleTtlSeconds, maxLifetimeSeconds }
}

type ApiTokenSqlRow = Record<string, SqlStorageValue>

function mapRow(row: ApiTokenSqlRow): ApiTokenRecord {
	const { scopes_json, ...rest } = row
	return { ...rest, scopes: JSON.parse(String(scopes_json)) } as ApiTokenRecord
}

function status(record: ApiTokenRecord, now: Date) {
	if (record.revoked_at) return 'revoked' as const
	return Date.parse(record.expires_at) > now.getTime() ? ('active' as const) : ('expired' as const)
}

function view(record: ApiTokenRecord, now: Date): ApiTokenView {
	return {
		id: record.id,
		name: record.name,
		org_id: record.user_id,
		org_binding: 'user',
		scopes: record.scopes,
		status: status(record, now),
		idle_ttl_seconds: record.idle_ttl_seconds,
		expires_at: record.expires_at,
		max_expires_at: record.max_expires_at,
		created_via: record.created_via,
		created_at: record.created_at,
		last_used_at: record.last_used_at,
		rotated_at: record.rotated_at,
		revoked_at: record.revoked_at,
		profile_name: null,
	}
}

function normalizeScopes(values: ReadonlyArray<unknown>) {
	const unknown = values.filter((value) => typeof value !== 'string' || !orgPermissionScopeSet.has(value))
	if (unknown.length > 0) {
		throw new KodyError('invalid_request', `Unknown API token scope(s): ${unknown.map(String).join(', ')}.`)
	}
	return [...new Set(values as ReadonlyArray<string>)].sort()
}

function slidingExpiry(now: Date, idleTtlSeconds: number, maxExpiresAt: string) {
	return new Date(Math.min(now.getTime() + idleTtlSeconds * 1000, Date.parse(maxExpiresAt))).toISOString()
}

function timingSafeEqual(left: string, right: string) {
	if (left.length !== right.length) return false
	let difference = 0
	for (let index = 0; index < left.length; index += 1) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
	}
	return difference === 0
}

export class ApiTokenStore {
	private readonly sql: SqlStorage

	constructor(sql: SqlStorage) {
		this.sql = sql
	}

	async mint(input: {
		userId: string
		name: string
		scopes: ReadonlyArray<string>
		createdVia: string
		lifetime?: string | null
		idleTtlSeconds?: number
		maxLifetimeSeconds?: number
		parent?: { scopes: ReadonlyArray<string>; maxExpiresAt: string }
		now?: Date
	}): Promise<ApiTokenSecretView> {
		const now = input.now ?? new Date()
		const name = input.name.trim()
		if (!name) throw new KodyError('invalid_request', 'Token name is required.')
		if (name.length > apiTokenPolicy.maxNameLength) {
			throw new KodyError('invalid_request', `Token name must be at most ${apiTokenPolicy.maxNameLength} characters.`)
		}
		const scopes = normalizeScopes(input.scopes)
		if (scopes.length === 0) {
			throw new KodyError('invalid_request', 'At least one scope is required.')
		}
		const lifetime = resolveApiTokenLifetime(input)
		if (input.parent) {
			const missing = scopes.filter((scope) => !input.parent!.scopes.includes(scope))
			if (missing.length > 0) {
				throw new KodyError('invalid_request', `A token cannot grant scopes it does not hold: ${missing.join(', ')}.`)
			}
		}
		const nowIso = now.toISOString()
		const active =
			this.sql
				.exec<{ count: number }>(
					'SELECT count(*) AS count FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
					input.userId,
					nowIso,
				)
				.toArray()[0]?.count ?? 0
		if (active >= apiTokenPolicy.maxActiveTokensPerUser) {
			throw new KodyError(
				'invalid_request',
				`This account already has ${apiTokenPolicy.maxActiveTokensPerUser} active API tokens and none can be reclaimed (protected tokens cannot be revoked). Revoke one before minting another.`,
			)
		}
		const id = generateApiTokenId()
		const secret = generateApiTokenSecret()
		let maxExpiresAtMs = now.getTime() + lifetime.maxLifetimeSeconds * 1000
		if (input.parent) maxExpiresAtMs = Math.min(maxExpiresAtMs, Date.parse(input.parent.maxExpiresAt))
		if (maxExpiresAtMs <= now.getTime()) {
			throw new KodyError(
				'invalid_request',
				'The resulting API token would already be expired (absolute max expiry is not in the future).',
			)
		}
		const maxExpiresAt = new Date(maxExpiresAtMs).toISOString()
		const record: ApiTokenRecord = {
			id,
			user_id: input.userId,
			name,
			token_hash: await sha256Hex(secret),
			scopes,
			idle_ttl_seconds: lifetime.idleTtlSeconds,
			expires_at: slidingExpiry(now, lifetime.idleTtlSeconds, maxExpiresAt),
			max_expires_at: maxExpiresAt,
			created_via: input.createdVia,
			created_at: nowIso,
			updated_at: nowIso,
			last_used_at: null,
			rotated_at: null,
			revoked_at: null,
		}
		this.sql.exec(
			`INSERT INTO api_tokens (
				id, user_id, name, token_hash, scopes_json, idle_ttl_seconds, expires_at,
				max_expires_at, created_via, created_at, updated_at, last_used_at, rotated_at, revoked_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			record.id,
			record.user_id,
			record.name,
			record.token_hash,
			JSON.stringify(record.scopes),
			record.idle_ttl_seconds,
			record.expires_at,
			record.max_expires_at,
			record.created_via,
			record.created_at,
			record.updated_at,
			record.last_used_at,
			record.rotated_at,
			record.revoked_at,
		)
		return { ...view(record, now), token: formatApiToken({ tokenId: id, secret }), token_type: 'Bearer' }
	}

	async resolve(token: string, now = new Date()): Promise<{ userId: string; tokenId: string } | null> {
		const parsed = parseApiToken(token)
		if (!parsed) return null
		const row = this.sql
			.exec<ApiTokenSqlRow>('SELECT * FROM api_tokens WHERE id = ? LIMIT 1', parsed.tokenId)
			.toArray()[0]
		if (!row) return null
		const record = mapRow(row)
		if (!timingSafeEqual(await sha256Hex(parsed.secret), record.token_hash)) return null
		if (status(record, now) !== 'active') return null
		const nowIso = now.toISOString()
		const expiresAt = slidingExpiry(now, record.idle_ttl_seconds, record.max_expires_at)
		const updated = this.sql.exec(
			`UPDATE api_tokens SET expires_at = ?, last_used_at = ?, updated_at = ?
			 WHERE id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
			expiresAt,
			nowIso,
			nowIso,
			record.id,
			record.token_hash,
			nowIso,
		)
		if (updated.rowsWritten === 0) return null
		return { userId: record.user_id, tokenId: record.id }
	}

	getCurrent(userId: string, tokenId: string, now = new Date()): ApiTokenView | null {
		const row = this.sql
			.exec<ApiTokenSqlRow>('SELECT * FROM api_tokens WHERE id = ? AND user_id = ? LIMIT 1', tokenId, userId)
			.toArray()[0]
		return row ? view(mapRow(row), now) : null
	}

	list(userId: string, includeInactive = false, now = new Date()): Array<ApiTokenView> {
		return this.sql
			.exec<ApiTokenSqlRow>('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, id ASC', userId)
			.toArray()
			.map(mapRow)
			.filter((record) => includeInactive || status(record, now) === 'active')
			.map((record) => view(record, now))
	}

	get(userId: string, tokenId: string, now = new Date()): ApiTokenView | null {
		const row = this.sql
			.exec<ApiTokenSqlRow>('SELECT * FROM api_tokens WHERE id = ? AND user_id = ? LIMIT 1', tokenId, userId)
			.toArray()[0]
		return row ? view(mapRow(row), now) : null
	}

	async rotate(userId: string, tokenId: string, now = new Date()): Promise<ApiTokenSecretView | null> {
		const row = this.sql
			.exec<ApiTokenSqlRow>('SELECT * FROM api_tokens WHERE id = ? AND user_id = ? LIMIT 1', tokenId, userId)
			.toArray()[0]
		if (!row) return null
		const record = mapRow(row)
		if (status(record, now) !== 'active') return null
		const secret = generateApiTokenSecret()
		const hash = await sha256Hex(secret)
		const nowIso = now.toISOString()
		const expiresAt = slidingExpiry(now, record.idle_ttl_seconds, record.max_expires_at)
		const updated = this.sql.exec(
			`UPDATE api_tokens SET token_hash = ?, expires_at = ?, rotated_at = ?, updated_at = ?
			 WHERE id = ? AND user_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
			hash,
			expiresAt,
			nowIso,
			nowIso,
			record.id,
			userId,
			record.token_hash,
			nowIso,
		)
		if (updated.rowsWritten === 0) return null
		return {
			...view({ ...record, token_hash: hash, expires_at: expiresAt, rotated_at: nowIso, updated_at: nowIso }, now),
			token: formatApiToken({ tokenId: record.id, secret }),
			token_type: 'Bearer',
		}
	}

	async rotateCurrent(userId: string, tokenId: string, now = new Date()): Promise<ApiTokenSecretView | null> {
		return this.rotate(userId, tokenId, now)
	}

	revoke(userId: string, tokenId: string, now = new Date()) {
		const nowIso = now.toISOString()
		return (
			this.sql.exec(
				`UPDATE api_tokens SET revoked_at = ?, updated_at = ?
				 WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
				nowIso,
				nowIso,
				tokenId,
				userId,
			).rowsWritten > 0
		)
	}

	revokeCurrent(userId: string, tokenId: string, now = new Date()) {
		return this.revoke(userId, tokenId, now)
	}
}
