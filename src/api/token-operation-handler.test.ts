import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Principal } from '../auth/authenticate.ts'
import type { AuditEntry } from '../cells/registry-cell.ts'
import type { Env } from '../env.ts'
import { cliClientId } from '../oauth/cli-client-metadata.ts'
import { handleTokenOperation } from './token-operation-handler.ts'

type AuditInput = Omit<AuditEntry, 'id' | 'at'>

function fixture() {
	const user = { id: 'user-id', email: 'person@example.com', createdAt: '2026-01-01T00:00:00.000Z' }
	const tokenId = 'token-id'
	const deviceTokenId = 'device-token-id'
	const deviceCredential = `kody_at_${randomUUID()}`
	const rotatedCredential = `kody_at_${randomUUID()}`
	const tokenHash = randomUUID()
	const auditEntries: Array<AuditInput> = []
	const behavior = { failRotate: false, failRevoke: false }
	const registry = {
		apiTokenMint: async (input: { name: string; createdVia: string }) => ({
			id: deviceTokenId,
			name: input.name,
			created_via: input.createdVia,
			token: deviceCredential,
		}),
		apiTokenRotateCurrent: async () => (behavior.failRotate ? null : { id: tokenId, token: rotatedCredential }),
		apiTokenRevokeCurrent: async () => !behavior.failRevoke,
		auditAppend: async (entry: AuditInput) => {
			auditEntries.push(entry)
			return { ...entry, id: 'audit-id', at: '2026-01-01T00:00:00.000Z' }
		},
	}
	const publicUrl = 'https://celld.example'
	const env = { KODY_PUBLIC_URL: publicUrl, REGISTRY: { getByName: () => registry } } as unknown as Env
	const oauthPrincipal = {
		user,
		userCell: {},
		via: 'oauth',
		clientName: 'kody-cli',
		oauthClientId: cliClientId(publicUrl),
	} as Principal
	const otherOAuthPrincipal = {
		...oauthPrincipal,
		oauthClientId: 'mcpc_other',
	} as Principal
	const tokenPrincipal = {
		user,
		userCell: {},
		via: 'kody_api_token',
		clientName: null,
		apiTokenId: tokenId,
	} as Principal
	return {
		env,
		behavior,
		auditEntries,
		tokenId,
		deviceTokenId,
		deviceCredential,
		rotatedCredential,
		tokenHash,
		oauthPrincipal,
		otherOAuthPrincipal,
		tokenPrincipal,
	}
}

test('audits kody_at_ token issue, rotation, and revocation without credential material', async () => {
	const fixtureValues = fixture()
	const {
		env,
		auditEntries,
		tokenId,
		deviceTokenId,
		deviceCredential,
		rotatedCredential,
		tokenHash,
		oauthPrincipal,
		tokenPrincipal,
	} = fixtureValues

	const issueResponse = await handleTokenOperation('cliLoginDeviceToken', { name: 'audit-test' }, env, oauthPrincipal)
	assert.equal(issueResponse.status, 200)
	assert.equal(((await issueResponse.json()) as { token: string }).token, deviceCredential)

	const rotateResponse = await handleTokenOperation('tokenRotateCurrent', {}, env, tokenPrincipal)
	assert.equal(rotateResponse.status, 200)
	assert.equal(((await rotateResponse.json()) as { token: string }).token, rotatedCredential)

	const revokeResponse = await handleTokenOperation('tokenRevokeCurrent', {}, env, tokenPrincipal)
	assert.equal(revokeResponse.status, 200)

	assert.deepEqual(auditEntries, [
		{
			actor: 'user:user-id',
			action: 'token.issue',
			target: 'user-id',
			details: { kind: 'kody_at', tokenId: deviceTokenId, createdVia: 'cli-login', name: 'audit-test' },
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
	for (const credential of [deviceCredential, rotatedCredential, tokenHash]) {
		assert.equal(serializedEntries.includes(credential), false)
	}
})

test('does not audit failed kody_at_ token operations', async () => {
	const { env, behavior, auditEntries, tokenPrincipal, otherOAuthPrincipal } = fixture()

	await assert.rejects(handleTokenOperation('cliLoginDeviceToken', {}, env, tokenPrincipal))
	await assert.rejects(handleTokenOperation('cliLoginDeviceToken', {}, env, otherOAuthPrincipal))

	behavior.failRotate = true
	await assert.rejects(handleTokenOperation('tokenRotateCurrent', {}, env, tokenPrincipal))

	behavior.failRevoke = true
	await assert.rejects(handleTokenOperation('tokenRevokeCurrent', {}, env, tokenPrincipal))
	assert.deepEqual(auditEntries, [])
})
