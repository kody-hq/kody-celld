import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Principal } from '../auth/authenticate.ts'
import type { AuditEntry } from '../cells/registry-cell.ts'
import type { Env } from '../env.ts'
import { handleTokenOperation } from './http-handler.ts'

type AuditInput = Omit<AuditEntry, 'id' | 'at'>

function fixture() {
	const user = { id: 'user-id', email: 'person@example.com', createdAt: '2026-01-01T00:00:00.000Z' }
	const createdTokenId = 'created-token-id'
	const tokenId = 'token-id'
	const createdCredential = `kody_at_${randomUUID()}`
	const rotatedCredential = `kody_at_${randomUUID()}`
	const tokenHash = randomUUID()
	const auditEntries: Array<AuditInput> = []
	const behavior = { failCreate: false, failRotate: false, failRevoke: false }
	const registry = {
		apiTokenMint: async (input: { name: string; createdVia: string }) => {
			if (behavior.failCreate) throw new Error('create failed')
			return {
				id: createdTokenId,
				name: input.name,
				created_via: input.createdVia,
				token: createdCredential,
			}
		},
		apiTokenRotate: async () => (behavior.failRotate ? null : { id: tokenId, token: rotatedCredential }),
		apiTokenRevoke: async () => !behavior.failRevoke,
		auditAppend: async (entry: AuditInput) => {
			auditEntries.push(entry)
			return { ...entry, id: 'audit-id', at: '2026-01-01T00:00:00.000Z' }
		},
	}
	const env = { KODY_PUBLIC_URL: 'https://celld.example', REGISTRY: { getByName: () => registry } } as unknown as Env
	const auth = {
		user,
		userCell: {},
		via: 'oauth',
		clientName: '@kodycodes/cli',
		oauthClientId: 'https://celld.example/oauth/cli-client-metadata.json',
	} as Principal
	return { env, behavior, auditEntries, createdTokenId, tokenId, createdCredential, rotatedCredential, tokenHash, auth }
}

test('audits kody_at_ collection token create, rotation, and revocation without credential material', async () => {
	const fixtureValues = fixture()
	const { env, auditEntries, createdTokenId, tokenId, createdCredential, rotatedCredential, tokenHash, auth } =
		fixtureValues

	const createResponse = await handleTokenOperation(
		'tokenCreate',
		{ name: 'audit-test', scopes: ['packages:read'] },
		env,
		auth,
	)
	assert.equal(createResponse.status, 200)
	assert.equal(((await createResponse.json()) as { token: string }).token, createdCredential)

	const rotateResponse = await handleTokenOperation('tokenRotate', { token_id: tokenId }, env, auth)
	assert.equal(rotateResponse.status, 200)
	assert.equal(((await rotateResponse.json()) as { token: string }).token, rotatedCredential)

	const revokeResponse = await handleTokenOperation('tokenRevoke', { token_id: tokenId }, env, auth)
	assert.equal(revokeResponse.status, 200)

	assert.deepEqual(auditEntries, [
		{
			actor: 'user:user-id',
			action: 'token.issue',
			target: 'user-id',
			details: {
				kind: 'kody_at',
				tokenId: createdTokenId,
				createdVia: 'mcp-api',
				name: 'audit-test',
			},
		},
		{
			actor: 'user:user-id',
			action: 'token.rotate',
			target: tokenId,
			details: { kind: 'kody_at' },
		},
		{
			actor: 'user:user-id',
			action: 'token.revoke',
			target: tokenId,
			details: { kind: 'kody_at' },
		},
	])
	const serializedEntries = JSON.stringify(auditEntries)
	for (const credential of [createdCredential, rotatedCredential, tokenHash]) {
		assert.equal(serializedEntries.includes(credential), false)
	}
})

test('does not audit failed kody_at_ collection token mutations', async () => {
	const { env, behavior, auditEntries, auth } = fixture()
	const params = { name: 'audit-test', scopes: ['packages:read'] }

	behavior.failCreate = true
	await assert.rejects(handleTokenOperation('tokenCreate', params, env, auth))

	behavior.failCreate = false
	behavior.failRotate = true
	await assert.rejects(handleTokenOperation('tokenRotate', { token_id: 'token-id' }, env, auth))

	behavior.failRevoke = true
	await assert.rejects(handleTokenOperation('tokenRevoke', { token_id: 'token-id' }, env, auth))
	assert.deepEqual(auditEntries, [])
})

test('rejects collection token create from a third-party OAuth client without minting or auditing', async () => {
	const { env, auditEntries, auth } = fixture()
	let minted = false
	const registry = env.REGISTRY.getByName('registry') as unknown as { apiTokenMint: () => unknown }
	registry.apiTokenMint = () => {
		minted = true
		throw new Error('must not mint')
	}
	await assert.rejects(
		handleTokenOperation('tokenCreate', { name: 'third-party', scopes: ['packages:read'] }, env, {
			...auth,
			clientName: 'Some MCP Host',
			oauthClientId: 'mcpc_third_party',
		} as Principal),
		(error: Error & { code?: string }) => {
			assert.equal(error.code, 'invalid_request')
			assert.match(error.message, /official CLI client/)
			return true
		},
	)
	assert.equal(minted, false)
	assert.deepEqual(auditEntries, [])
})
