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

	it('creates tokens with hosted lifetime forms, normalizes scopes, and caps child lifetime', async () => {
		const { store } = makeStore()
		const short = await mint(store, { lifetime: 'short', now: time })
		const long = await mint(store, { lifetime: 'long', now: time })
		const explicit = await mint(store, { idleTtlSeconds: 120, maxLifetimeSeconds: 600, now: time })
		assert.equal(short.idle_ttl_seconds, 3600)
		assert.equal(short.max_expires_at, '2026-01-02T00:00:00.000Z')
		assert.equal(long.idle_ttl_seconds, 1209600)
		assert.equal(long.max_expires_at, '2026-04-01T00:00:00.000Z')
		assert.equal(explicit.idle_ttl_seconds, 120)
		assert.equal(explicit.max_expires_at, '2026-01-01T00:10:00.000Z')
		assert.deepEqual(
			(await mint(store, { scopes: ['package:execute', 'org:read', 'org:read'], lifetime: 'short', now: time })).scopes,
			['org:read', 'package:execute'],
		)
		await assert.rejects(
			mint(store, { scopes: ['not-a-scope'], lifetime: 'short', now: time }),
			/Unknown API token scope\(s\): not-a-scope\./,
		)
		await assert.rejects(mint(store, { scopes: [], lifetime: 'short', now: time }), /At least one scope is required/)
		await assert.rejects(mint(store, { scopes, now: time }), /Token lifetime is required/)
		await assert.rejects(
			mint(store, { scopes, lifetime: 'short', idleTtlSeconds: 60, maxLifetimeSeconds: 60, now: time }),
			/not both forms/,
		)
		await assert.rejects(
			mint(store, { scopes, idleTtlSeconds: 59, maxLifetimeSeconds: 60, now: time }),
			/integer between 60 and 1209600/,
		)
		const child = await mint(store, {
			scopes: ['org:read'],
			lifetime: 'long',
			parent: { scopes: ['org:read'], maxExpiresAt: new Date(time.getTime() + 60_000).toISOString() },
			now: time,
		})
		assert.equal(child.max_expires_at, '2026-01-01T00:01:00.000Z')
		await assert.rejects(
			mint(store, {
				scopes: ['package:execute'],
				lifetime: 'short',
				parent: { scopes: ['org:read'], maxExpiresAt: new Date(time.getTime() + 60_000).toISOString() },
				now: time,
			}),
			/A token cannot grant scopes it does not hold: package:execute\./,
		)
	})

	it('lists only the caller’s tokens in hosted order and can include inactive entries', async () => {
		const { store } = makeStore()
		const revoked = await mint(store, { name: 'revoked', lifetime: 'short', now: new Date(time.getTime() - 1000) })
		const tiedOne = await mint(store, { name: 'tied one', lifetime: 'short', now: time })
		const tiedTwo = await mint(store, { name: 'tied two', lifetime: 'short', now: time })
		const later = await mint(store, { name: 'later', lifetime: 'short', now: new Date(time.getTime() + 1000) })
		const expired = await mint(store, {
			name: 'expired',
			idleTtlSeconds: 60,
			maxLifetimeSeconds: 60,
			now: time,
		})
		const revokedId = parseApiToken(revoked.token)!.tokenId
		assert.equal(store.revoke(userId, revokedId, time), true)
		await mint(store, { userId: 'user_b', name: 'other user', lifetime: 'short', now: time })

		const active = store.list(userId, false, new Date(time.getTime() + 61_000))
		assert.deepEqual(
			active.map((token) => token.id),
			[
				parseApiToken(later.token)!.tokenId,
				...[parseApiToken(tiedOne.token)!.tokenId, parseApiToken(tiedTwo.token)!.tokenId].sort(),
			],
		)
		assert(active.every((token) => token.status === 'active'))
		const inactive = store.list(userId, true, new Date(time.getTime() + 61_000))
		assert.equal(inactive.find((token) => token.id === revokedId)?.status, 'revoked')
		assert.equal(inactive.find((token) => token.id === parseApiToken(expired.token)!.tokenId)?.status, 'expired')
		assert.equal(inactive.length, 5)
		assert.deepEqual(
			store.list('user_b', false, time).map((token) => token.name),
			['other user'],
		)
		assert.equal(store.list('missing-user', true, time).length, 0)
		const view = inactive.find((token) => token.id === parseApiToken(tiedOne.token)!.tokenId)!
		assert.equal(view.org_id, userId)
		assert.equal(view.org_binding, 'user')
		assert.equal(view.profile_name, null)
		assert.equal(view.created_via, 'cli-login')
		assert.equal('token' in view, false)
	})

	it('gets, rotates, and revokes by id without crossing user boundaries', async () => {
		const { store } = makeStore()
		const created = await mint(store, { lifetime: 'short', now: time })
		const id = parseApiToken(created.token)!.tokenId
		assert.equal(store.get(userId, id, time)?.id, id)
		assert.equal(store.get('user_b', id, time), null)
		assert.equal(store.get(userId, 'unknown-id', time), null)
		assert.equal(await store.rotate('user_b', id, time), null)
		assert.equal(await store.rotate(userId, 'unknown-id', time), null)
		assert.equal(store.revoke('user_b', id, time), false)
		assert.equal(store.revoke(userId, 'unknown-id', time), false)
		const rotated = await store.rotate(userId, id, time)
		assert.ok(rotated)
		assert.equal(await store.resolve(created.token, time), null)
		assert.equal(store.revoke(userId, id, time), true)
		assert.equal(await store.resolve(rotated.token, time), null)
		assert.equal(store.get(userId, id, time)?.status, 'revoked')
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
