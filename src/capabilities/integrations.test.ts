import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import type { Env } from '../env.ts'
import { ensureIntegrationColumns, IntegrationStore, integrationSchema } from '../integrations/store.ts'
import { buildMasterKeyring } from '../lib/crypto.ts'
import { KodyError } from '../lib/errors.ts'
import type { CapabilityContext } from './define.ts'
import { integrationSave, integrationSetUsage } from './integrations.ts'

/** Just enough of Durable Object `SqlStorage` for the store (same shim as integrations/store.test.ts). */
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

const resolverOrigin = 'https://dns.test'

async function setup() {
	const sql = memorySql()
	sql.exec(integrationSchema)
	ensureIntegrationColumns(sql)
	const ring = await buildMasterKeyring('integration-capability-key')
	const tokenRequests: Array<string> = []
	const store = new IntegrationStore({
		sql,
		userId: () => 'user_1',
		keyring: async () => ring,
		hostPolicy: { allowPrivateHosts: [], dnsResolverUrl: `${resolverOrigin}/dns-query` },
		fetch: async (input) => {
			const url = new URL(String(input))
			if (url.origin === resolverOrigin) {
				const type = url.searchParams.get('type')
				return Response.json({ Status: 0, Answer: type === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] })
			}
			tokenRequests.push(url.href)
			return Response.json({ access_token: `at-${tokenRequests.length}`, token_type: 'Bearer' })
		},
	})
	const userCell = {
		integrationGet: async (name: string) => store.get(name),
		integrationSave: async (input: {
			config: Parameters<IntegrationStore['save']>[0]
			clientSecret: string | null | undefined
		}) => store.save(input.config, input.clientSecret),
		integrationSetUsage: async (input: { name: string; usage: Parameters<IntegrationStore['setUsage']>[1] }) =>
			store.setUsage(input.name, input.usage),
	}
	const env = { REGISTRY: { getByName: () => ({ auditAppend: async () => {} }) } } as unknown as Env
	const context = (fromRuntime: boolean) =>
		({
			env,
			user: { id: 'user_1' },
			userCell,
			packageName: null,
			fromRuntime,
			baseUrl: 'https://cell.example.test',
		}) as unknown as CapabilityContext
	const saved = {
		name: 'acme',
		flow: 'client_credentials',
		tokenUrl: 'https://auth.acme.example/token',
		clientId: 'acme-client',
		allowedHosts: ['api.acme.example', 'uploads.acme.example'],
		usage: { mode: 'packages', packages: ['@me/acme-sync'] },
	}
	await integrationSave.handler({ ...saved, clientSecret: 'acme-client-secret' }, context(false))
	assert.equal((await store.refresh('acme')).ok, true)
	return { store, saved, runtime: context(true), session: context(false), tokenRequests }
}

async function assertLocked(promise: Promise<unknown>) {
	await assert.rejects(promise, (error: unknown) => {
		assert(error instanceof KodyError)
		assert.equal(error.code, 'integration_locked')
		assert.equal(error.status, 403)
		return true
	})
}

describe('integration settings from runtime code', () => {
	it('ad hoc execute cannot re-point a live token at another host and unlock it', async () => {
		const { store, saved, runtime, tokenRequests } = await setup()
		await assertLocked(
			integrationSave.handler(
				{ ...saved, allowedHosts: ['collector.attacker.example'], usage: { mode: 'any' } },
				runtime,
			),
		)
		await assertLocked(integrationSave.handler({ ...saved, allowedHosts: ['collector.attacker.example'] }, runtime))
		await assertLocked(integrationSave.handler({ ...saved, usage: { mode: 'any' } }, runtime))
		await assertLocked(integrationSetUsage.handler({ name: 'acme', usage: { mode: 'any' } }, runtime))
		await assertLocked(
			integrationSetUsage.handler(
				{ name: 'acme', usage: { mode: 'packages', packages: ['@me/acme-sync', '@me/other'] } },
				runtime,
			),
		)
		const record = store.get('acme')!
		assert.deepEqual(record.allowedHosts, saved.allowedHosts)
		assert.deepEqual(record.usage, saved.usage)
		const resolution = await store.tokenResolve({ name: 'acme', packageName: null, host: 'collector.attacker.example' })
		assert.equal(resolution.ok, false)
		assert.equal(tokenRequests.length, 1)
	})

	it('ad hoc execute may still narrow hosts and usage', async () => {
		const { store, saved, runtime } = await setup()
		await integrationSave.handler({ ...saved, allowedHosts: ['api.acme.example'] }, runtime)
		await integrationSetUsage.handler(
			{ name: 'acme', usage: { mode: 'packages', packages: ['@me/acme-sync'] } },
			runtime,
		)
		const record = store.get('acme')!
		assert.deepEqual(record.allowedHosts, ['api.acme.example'])
		assert.equal(record.status, 'connected', 'narrowing keeps the live token')
	})

	it('the MCP session or REST API may widen, and adding a host drops the live token', async () => {
		const { store, saved, session } = await setup()
		await integrationSave.handler(
			{ ...saved, allowedHosts: [...saved.allowedHosts, 'files.acme.example'], usage: { mode: 'any' } },
			session,
		)
		const record = store.get('acme')!
		assert.deepEqual(record.usage, { mode: 'any' })
		assert.equal(record.status, 'pending')
	})
})
