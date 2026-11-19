import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { buildMasterKeyring } from '../lib/crypto.ts'
import { lastUsedWriteIntervalMs } from '../lib/last-used.ts'
import { parseIntegrationConfig } from './oauth.ts'
import { forwardedTarget, forwarderRefusal } from '../../tools/egress-test-fixture.ts'
import { ensureIntegrationColumns, IntegrationStore, integrationSchema } from './store.ts'

/** Just enough of Durable Object `SqlStorage` for the store (same shim as oauth-store.test.ts). */
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

type SeenRequest = { url: string; body: string; authorization: string | null }

async function makeStore(sql = memorySql(), allowPrivateHosts: Array<string> = []) {
	sql.exec(integrationSchema)
	ensureIntegrationColumns(sql)
	const ring = await buildMasterKeyring('integration-store-key')
	const requests: Array<SeenRequest> = []
	const store = new IntegrationStore({
		sql,
		userId: () => 'user_1',
		keyring: async () => ring,
		hostPolicy: { allowPrivateHosts },
		fetch: async (input, init) => {
			const url = forwardedTarget(input, init)
			const refusal = forwarderRefusal(
				url.hostname,
				[url.hostname === 'internal.acme.example' ? '10.0.0.7' : '93.184.216.34'],
				allowPrivateHosts,
			)
			if (refusal) return refusal
			const headers = new Headers(init?.headers)
			requests.push({ url: url.href, body: String(init?.body ?? ''), authorization: headers.get('authorization') })
			return new Response(JSON.stringify({ access_token: `at-${requests.length}`, token_type: 'Bearer' }), {
				headers: { 'content-type': 'application/json' },
			})
		},
	})
	return { store, sql, requests }
}

const oldSecret = 'old-client-secret-value'

const m2m = (overrides: Record<string, unknown> = {}) =>
	parseIntegrationConfig({
		name: 'acme',
		flow: 'client_credentials',
		tokenUrl: 'https://auth.acme.example/token',
		clientId: 'acme-client',
		allowedHosts: ['api.acme.example'],
		...overrides,
	})

const authCode = (overrides: Record<string, unknown> = {}) =>
	parseIntegrationConfig({
		name: 'acme',
		authorizeUrl: 'https://auth.acme.example/authorize',
		tokenUrl: 'https://auth.acme.example/token',
		clientId: 'acme-client',
		allowedHosts: ['api.acme.example'],
		...overrides,
	})

/** Never seen in any request: neither in the body nor (base64) in a Basic header. */
function assertNoSecret(requests: Array<SeenRequest>, secret: string) {
	for (const request of requests) {
		assert.ok(!request.body.includes(encodeURIComponent(secret)), `${request.url} body carried the secret`)
		const basic = request.authorization?.replace(/^Basic\s+/, '')
		if (basic) assert.ok(!atob(basic).includes(encodeURIComponent(secret)), `${request.url} Basic carried the secret`)
	}
}

/** Runs the browser connect flow to the token exchange and returns once the code was exchanged. */
async function connect(store: IntegrationStore, name: string) {
	const ticket = await store.connectStart(name, 'https://kody.example/connect/oauth/callback')
	const { authorizeUrl } = await store.connectBegin({ connectId: ticket.connectId, ticket: ticket.ticket })
	const state = new URL(authorizeUrl).searchParams.get('state')!
	const [, connectId, nonce] = state.split('.')
	await store.connectComplete({ connectId: connectId!, nonce: nonce!, code: 'auth-code', providerError: null })
}

describe('IntegrationStore client secret binding', () => {
	it('a re-save that moves tokenUrl to another host never sends the old secret there', async () => {
		const { store, requests } = await makeStore()
		await store.save(m2m(), oldSecret)
		assert.equal((await store.refresh('acme')).ok, true)
		assert.ok(requests[0]!.body.includes(oldSecret), 'the original token URL gets its own secret')

		const moved = await store.save(m2m({ tokenUrl: 'https://collector.other.example/token' }), undefined)
		assert.equal(moved.hasClientSecret, false)
		const result = await store.refresh('acme')
		assert.equal(result.ok, false)
		assert.equal(result.ok ? null : result.code, 'integration_client_secret_required')
		assert.equal(requests.length, 1, 'nothing was sent to the new host')
		assertNoSecret(requests.slice(1), oldSecret)
	})

	it('authorization_code: the new token host gets no secret, in the body or as Basic auth', async () => {
		for (const tokenAuthStyle of ['body', 'basic'] as const) {
			const { store, requests } = await makeStore()
			await store.save(authCode({ tokenAuthStyle }), oldSecret)
			await store.save(authCode({ tokenAuthStyle, tokenUrl: 'https://collector.other.example/token' }), undefined)
			await connect(store, 'acme')
			assert.equal(requests.length, 1)
			assert.equal(requests[0]!.url, 'https://collector.other.example/token')
			assertNoSecret(requests, oldSecret)
		}
	})

	it('a new clientId drops the stored secret too', async () => {
		const { store, requests } = await makeStore()
		await store.save(m2m(), oldSecret)
		const rotated = await store.save(m2m({ clientId: 'other-client' }), undefined)
		assert.equal(rotated.hasClientSecret, false)
		assert.equal((await store.refresh('acme')).ok, false)
		assert.equal(requests.length, 0)
	})

	it('a re-save with the same clientId and tokenUrl keeps the secret', async () => {
		const { store, requests } = await makeStore()
		await store.save(m2m(), oldSecret)
		const kept = await store.save(
			m2m({ scopes: ['read'], allowedHosts: ['api.acme.example', 'x.acme.example'] }),
			undefined,
		)
		assert.equal(kept.hasClientSecret, true)
		assert.equal((await store.refresh('acme')).ok, true)
		assert.ok(requests[0]!.body.includes(oldSecret))
	})

	it('a new tokenUrl saved with its own secret sends only that secret', async () => {
		const { store, requests } = await makeStore()
		await store.save(m2m(), oldSecret)
		const moved = await store.save(m2m({ tokenUrl: 'https://auth2.acme.example/token' }), 'new-client-secret')
		assert.equal(moved.hasClientSecret, true)
		assert.equal((await store.refresh('acme')).ok, true)
		assert.equal(requests[0]!.url, 'https://auth2.acme.example/token')
		assert.ok(requests[0]!.body.includes('new-client-secret'))
		assertNoSecret(requests, oldSecret)
	})

	it('a stored secret whose binding does not match the config is never decrypted or sent', async () => {
		const { store, sql, requests } = await makeStore()
		await store.save(m2m(), oldSecret)
		sql.exec(
			`UPDATE integrations SET config_json = json_set(config_json, '$.tokenUrl', ?) WHERE name = 'acme'`,
			'https://collector.other.example/token',
		)
		assert.equal(store.get('acme')!.hasClientSecret, false)
		const result = await store.refresh('acme')
		assert.equal(result.ok ? null : result.code, 'integration_client_secret_required')
		assert.equal(requests.length, 0)
	})

	it('connect refuses to start while the stored secret is bound to another tokenUrl', async () => {
		const { store, sql, requests } = await makeStore()
		await store.save(authCode(), oldSecret)
		sql.exec(
			`UPDATE integrations SET config_json = json_set(config_json, '$.tokenUrl', ?) WHERE name = 'acme'`,
			'https://collector.other.example/token',
		)
		await assert.rejects(
			() => store.connectStart('acme', 'https://kody.example/connect/oauth/callback'),
			(error: unknown) => (error as { code?: string }).code === 'integration_client_secret_required',
		)
		assert.equal(requests.length, 0)
	})

	it('binds legacy secrets to the client id and token URL they are stored with', async () => {
		const sql = memorySql()
		const legacySchema = integrationSchema.replace(
			/\s*client_secret_client_id TEXT,\s*client_secret_token_url TEXT,/,
			'',
		)
		assert.notEqual(legacySchema, integrationSchema)
		sql.exec(legacySchema)
		const seed = await makeStore(memorySql())
		await seed.store.save(m2m(), oldSecret)
		const row = seed.sql.exec<Record<string, string>>(`SELECT * FROM integrations WHERE name = 'acme'`).toArray()[0]!
		sql.exec(
			`INSERT INTO integrations (name, config_json, client_secret_iv, client_secret_ciphertext, client_secret_key_id, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
			row.name!,
			row.config_json!,
			row.client_secret_iv!,
			row.client_secret_ciphertext!,
			row.client_secret_key_id!,
			row.created_at!,
			row.updated_at!,
		)
		const { store, requests } = await makeStore(sql)
		assert.equal(store.get('acme')!.hasClientSecret, true)
		await store.save(m2m({ tokenUrl: 'https://collector.other.example/token' }), undefined)
		assert.equal(store.get('acme')!.hasClientSecret, false)
		assert.equal((await store.refresh('acme')).ok, false)
		assert.equal(requests.length, 0)
	})
})

describe('IntegrationStore token last-used debounce', () => {
	it('stamps the first use, skips repeats inside the window, and stamps again after it', async () => {
		const { store, sql } = await makeStore()
		await store.save(m2m(), oldSecret)
		assert.equal((await store.refresh('acme')).ok, true)
		const lastUsed = () =>
			sql
				.exec<{ last_used_at: string | null }>("SELECT last_used_at FROM integrations WHERE name = 'acme'")
				.toArray()[0]!.last_used_at
		const resolve = async () =>
			assert.equal((await store.tokenResolve({ name: 'acme', packageName: null, host: 'api.acme.example' })).ok, true)

		sql.exec("UPDATE integrations SET last_used_at = NULL WHERE name = 'acme'")
		await resolve()
		const first = lastUsed()
		assert.ok(first)
		await resolve()
		assert.equal(lastUsed(), first)

		const stale = new Date(Date.now() - lastUsedWriteIntervalMs - 1_000).toISOString()
		sql.exec("UPDATE integrations SET last_used_at = ? WHERE name = 'acme'", stale)
		await resolve()
		assert.ok(lastUsed()! > stale)
	})
})

describe('IntegrationStore allowedHosts changes', () => {
	it('a save that adds an allowed host clears the stored tokens', async () => {
		const { store } = await makeStore()
		await store.save(authCode(), oldSecret)
		await connect(store, 'acme')
		assert.equal(store.get('acme')!.status, 'connected')
		const widened = await store.save(
			authCode({ allowedHosts: ['api.acme.example', 'collector.other.example'] }),
			undefined,
		)
		assert.equal(widened.status, 'pending')
		const resolution = await store.tokenResolve({ name: 'acme', packageName: null, host: 'collector.other.example' })
		assert.equal(resolution.ok, false)
		assert.equal(resolution.ok ? null : resolution.code, 'integration_not_connected')
	})

	it('a save that only narrows allowedHosts keeps the tokens', async () => {
		const { store } = await makeStore()
		await store.save(authCode({ allowedHosts: ['api.acme.example', 'uploads.acme.example'] }), oldSecret)
		await connect(store, 'acme')
		const narrowed = await store.save(authCode({ allowedHosts: ['api.acme.example'] }), undefined)
		assert.equal(narrowed.status, 'connected')
	})

	it('a wildcard covering the old hosts still counts as an added host', async () => {
		const { store } = await makeStore()
		await store.save(authCode(), oldSecret)
		await connect(store, 'acme')
		assert.equal((await store.save(authCode({ allowedHosts: ['*.acme.example'] }), undefined)).status, 'pending')
	})
})

describe('IntegrationStore token endpoint host policy', () => {
	it('refuses private, loopback and metadata token endpoints before sending anything', async () => {
		for (const tokenUrl of [
			'https://169.254.169.254/token',
			'https://127.0.0.1:8443/token',
			'https://2130706433/token',
			'https://[::ffff:10.0.0.1]/token',
			'https://[fd00::1]/token',
			'https://internal.acme.example/token',
		]) {
			const { store, requests } = await makeStore()
			await store.save(m2m({ tokenUrl }), oldSecret)
			const result = await store.refresh('acme')
			assert.equal(result.ok, false, tokenUrl)
			assert.equal(result.ok ? null : result.code, 'private_host_refused', tokenUrl)
			assert.match(result.ok ? '' : result.message, /KODY_PRIVATE_HOSTS/)
			assert.deepEqual(requests, [], tokenUrl)
		}
	})

	it('a token endpoint listed in KODY_PRIVATE_HOSTS is allowed', async () => {
		const { store, requests } = await makeStore(undefined, ['10.0.0.0/8', 'internal.acme.example'])
		await store.save(m2m({ tokenUrl: 'https://internal.acme.example/token' }), oldSecret)
		assert.equal((await store.refresh('acme')).ok, true)
		await store.save(m2m({ tokenUrl: 'https://10.0.0.7/token' }), oldSecret)
		assert.equal((await store.refresh('acme')).ok, true)
		assert.deepEqual(
			requests.map((r) => r.url),
			['https://internal.acme.example/token', 'https://10.0.0.7/token'],
		)
	})
})
