import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { ApiTokenStore, apiTokenPolicy, apiTokenSchema, resolveApiTokenLifetime } from './api-token-store.ts'
import { generateApiTokenSecret, parseApiToken, formatApiToken } from '../lib/api-token-format.ts'
import { sha256Hex } from '../lib/crypto.ts'

function makeStore() {
	const db = new DatabaseSync(':memory:')
	const sql = {
		exec(query: string, ...params: Array<string | number | null>) {
			const statements = query.split(';').filter((statement) => statement.trim())
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
	sql.exec(apiTokenSchema)
	return { db, store: new ApiTokenStore(sql) }
}

const userId = 'user_a'
const scopes = ['org:read', 'package:execute']
const time = new Date('2026-01-01T00:00:00.000Z')

const mint = (store: ApiTokenStore, options: Record<string, unknown> = {}) =>
	store.mint({
		userId,
		name: 'test token',
		scopes,
		createdVia: 'cli-login',
		...options,
	} as Parameters<ApiTokenStore['mint']>[0])

describe('API token lifetime policy', () => {
	it('resolves short, long, and explicit lifetimes', () => {
		assert.deepEqual(resolveApiTokenLifetime({ lifetime: 'short' }), {
			idleTtlSeconds: 3600,
			maxLifetimeSeconds: 86400,
		})
		assert.deepEqual(resolveApiTokenLifetime({ lifetime: 'long' }), {
			idleTtlSeconds: 1209600,
			maxLifetimeSeconds: 7776000,
		})
		assert.deepEqual(resolveApiTokenLifetime({ idleTtlSeconds: 120, maxLifetimeSeconds: 600 }), {
			idleTtlSeconds: 120,
			maxLifetimeSeconds: 600,
		})
	})

	it('rejects missing, partial, mixed, and out-of-bounds lifetime inputs with hosted errors', () => {
		assert.throws(() => resolveApiTokenLifetime({}), /Token lifetime is required/)
		assert.throws(
			() => resolveApiTokenLifetime({ idleTtlSeconds: 60 }),
			/both idle_ttl_seconds and max_lifetime_seconds/,
		)
		assert.throws(
			() => resolveApiTokenLifetime({ lifetime: 'short', idleTtlSeconds: 60, maxLifetimeSeconds: 60 }),
			/not both forms/,
		)
		assert.throws(() => resolveApiTokenLifetime({ lifetime: 'unknown' }), /lifetime must be "short" or "long"/)
		assert.throws(
			() => resolveApiTokenLifetime({ idleTtlSeconds: 59, maxLifetimeSeconds: 60 }),
			/integer between 60 and 1209600/,
		)
		assert.throws(
			() => resolveApiTokenLifetime({ idleTtlSeconds: 1209601, maxLifetimeSeconds: 1209601 }),
			/integer between 60 and 1209600/,
		)
		assert.throws(
			() => resolveApiTokenLifetime({ idleTtlSeconds: 120, maxLifetimeSeconds: 119 }),
			/integer between 120 and 7776000/,
		)
		assert.throws(
			() =>
				resolveApiTokenLifetime({ idleTtlSeconds: 60, maxLifetimeSeconds: apiTokenPolicy.maxMaxLifetimeSeconds + 1 }),
			/integer between 60 and 7776000/,
		)
	})
})

describe('ApiTokenStore', () => {
	it('mints only a hash, trims names, and returns the hosted user-bound view', async () => {
		const { db, store } = makeStore()
		const result = await mint(store, { name: '  cli  ', lifetime: 'short', now: time })
		const parsed = parseApiToken(result.token)!
		const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(parsed.tokenId) as {
			token_hash: string
			name: string
			scopes_json: string
		}
		assert.equal(row.name, 'cli')
		assert.equal(row.token_hash, await sha256Hex(parsed.secret))
		assert.notEqual(row.token_hash, result.token)
		assert.deepEqual(JSON.parse(row.scopes_json), scopes)
		assert.equal(result.org_id, userId)
		assert.equal(result.org_binding, 'user')
		assert.equal(result.profile_name, null)
		assert.equal(result.status, 'active')
		assert.equal(result.created_via, 'cli-login')
		assert.equal(result.token_type, 'Bearer')
		assert.equal(store.getCurrent(userId, parsed.tokenId, time)?.id, parsed.tokenId)
	})

	it('rejects empty and overlong names', async () => {
		const { store } = makeStore()
		await assert.rejects(mint(store, { name: '  ', lifetime: 'short' }), /Token name is required/)
		await assert.rejects(mint(store, { name: 'x'.repeat(101), lifetime: 'short' }), /at most 100 characters/)
	})

	it('slides expiry but never extends beyond the absolute maximum', async () => {
		const { store } = makeStore()
		const created = await mint(store, {
			name: 'sliding',
			idleTtlSeconds: 60,
			maxLifetimeSeconds: 120,
			now: time,
		})
		const parsed = parseApiToken(created.token)!
		assert.equal(created.expires_at, '2026-01-01T00:01:00.000Z')
		assert.ok(await store.resolve(created.token, new Date(time.getTime() + 30_000)))
		const current = store.getCurrent(userId, parsed.tokenId, new Date(time.getTime() + 30_000))!
		assert.equal(current.expires_at, '2026-01-01T00:01:30.000Z')
		assert.equal(current.last_used_at, '2026-01-01T00:00:30.000Z')
		assert.ok(await store.resolve(created.token, new Date(time.getTime() + 80_000)))
		assert.equal(
			store.getCurrent(userId, parsed.tokenId, new Date(time.getTime() + 80_000))?.expires_at,
			'2026-01-01T00:02:00.000Z',
		)
		assert.equal(await store.resolve(created.token, new Date(time.getTime() + 120_000)), null)
	})

	it('rejects expired, revoked, and wrong-secret credentials', async () => {
		const { store } = makeStore()
		const expired = await mint(store, {
			name: 'expired',
			idleTtlSeconds: 60,
			maxLifetimeSeconds: 60,
			now: time,
		})
		assert.equal(await store.resolve(expired.token, new Date(time.getTime() + 60_000)), null)
		const active = await mint(store, { name: 'active', lifetime: 'short', now: time })
		const parsed = parseApiToken(active.token)!
		const wrong = formatApiToken({ tokenId: parsed.tokenId, secret: generateApiTokenSecret() })
		assert.equal(await store.resolve(wrong, time), null)
		assert.equal(store.revokeCurrent(userId, parsed.tokenId, time), true)
		assert.equal(await store.resolve(active.token, time), null)
	})

	it('rotates credentials, invalidates the prior value, and preserves scopes and max expiry', async () => {
		const { store } = makeStore()
		const old = await mint(store, {
			name: 'rotate',
			scopes,
			idleTtlSeconds: 60,
			maxLifetimeSeconds: 600,
			now: time,
		})
		const oldParsed = parseApiToken(old.token)!
		const rotated = await store.rotateCurrent(userId, oldParsed.tokenId, new Date(time.getTime() + 10_000))
		assert.ok(rotated)
		assert.notEqual(rotated.token, old.token)
		assert.equal(await store.resolve(old.token, new Date(time.getTime() + 10_000)), null)
		assert.ok(await store.resolve(rotated.token, new Date(time.getTime() + 10_000)))
		assert.deepEqual(rotated.scopes, scopes)
		assert.equal(rotated.max_expires_at, old.max_expires_at)
		assert.equal(rotated.rotated_at, '2026-01-01T00:00:10.000Z')
	})

	it('enforces the 500 active-token limit', async () => {
		const { db, store } = makeStore()
		const expiresAt = new Date(time.getTime() + 60_000).toISOString()
		for (let index = 0; index < apiTokenPolicy.maxActiveTokensPerUser; index += 1) {
			db.prepare(
				`INSERT INTO api_tokens (id, user_id, name, token_hash, scopes_json, idle_ttl_seconds,
				 expires_at, max_expires_at, created_via, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				`row-${index}`,
				userId,
				'active',
				await sha256Hex(generateApiTokenSecret()),
				'[]',
				60,
				expiresAt,
				expiresAt,
				'cli-login',
				time.toISOString(),
				time.toISOString(),
			)
		}
		await assert.rejects(mint(store, { name: 'overflow', lifetime: 'short', now: time }), /500 active API tokens/)
	})
})
