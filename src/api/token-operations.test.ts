import assert from 'node:assert/strict'
import test from 'node:test'
import type { Principal } from '../auth/authenticate.ts'
import {
	cliLoginDeviceTokenMessage,
	currentApiTokenMessage,
	requireCliLoginOAuthPrincipal,
	requireCurrentApiTokenPrincipal,
	requireTokenManagementPrincipal,
} from './token-operations.ts'

const officialClientId = 'https://celld.example/oauth/cli-client-metadata.json'
const principal = (via: Principal['via'], apiTokenId?: string, oauthClientId?: string) =>
	({ via, apiTokenId, oauthClientId }) as Principal

test('device token operation accepts only the official CLI OAuth principal', () => {
	assert.throws(
		() => requireCliLoginOAuthPrincipal(principal('api_token'), officialClientId),
		(error: Error) => {
			assert.equal(error.message, cliLoginDeviceTokenMessage)
			return true
		},
	)
	assert.throws(
		() => requireCliLoginOAuthPrincipal(principal('kody_api_token', 'token-id'), officialClientId),
		(error: Error) => {
			assert.equal(error.message, cliLoginDeviceTokenMessage)
			return true
		},
	)
	assert.throws(
		() => requireCliLoginOAuthPrincipal(principal('oauth', undefined, 'mcpc_other'), officialClientId),
		(error: Error) => error.message === cliLoginDeviceTokenMessage,
	)
	assert.doesNotThrow(() =>
		requireCliLoginOAuthPrincipal(principal('oauth', undefined, officialClientId), officialClientId),
	)
})

test('current-token operations reject non-kody_at_ principals', () => {
	for (const via of ['api_token', 'oauth'] as const) {
		assert.throws(
			() => requireCurrentApiTokenPrincipal(principal(via)),
			(error: Error) => {
				assert.equal(error.message, currentApiTokenMessage)
				return true
			},
		)
	}
	assert.throws(
		() => requireCurrentApiTokenPrincipal(principal('kody_api_token')),
		(error: Error) => error.message === currentApiTokenMessage,
	)
	assert.equal(requireCurrentApiTokenPrincipal(principal('kody_api_token', 'id-1')), 'id-1')
})

test('collection and by-id token operations allow the official CLI OAuth client, kc_, and kody_at_ callers', () => {
	assert.doesNotThrow(() =>
		requireTokenManagementPrincipal(principal('oauth', undefined, officialClientId), officialClientId),
	)
	assert.doesNotThrow(() => requireTokenManagementPrincipal(principal('api_token'), officialClientId))
	assert.doesNotThrow(() => requireTokenManagementPrincipal(principal('kody_api_token', 'token-id'), officialClientId))
	assert.throws(() => requireTokenManagementPrincipal(principal('kody_api_token'), officialClientId))
})

test('collection and by-id token operations reject other OAuth clients', () => {
	for (const oauthClientId of ['mcpc_third_party', 'https://other.example/oauth/cli-client-metadata.json', undefined]) {
		assert.throws(
			() => requireTokenManagementPrincipal(principal('oauth', undefined, oauthClientId), officialClientId),
			(error: Error) => {
				assert.equal(
					error.message,
					'Token management over OAuth is limited to the official CLI client. Use a kody_at_ or kc_ token, or sign in with kody login.',
				)
				return true
			},
		)
	}
})
