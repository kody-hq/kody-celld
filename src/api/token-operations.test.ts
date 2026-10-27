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

test('collection and by-id token operations allow OAuth, kc_, and kody_at_ callers', () => {
	for (const via of ['oauth', 'api_token', 'kody_api_token'] as const) {
		assert.doesNotThrow(() => requireTokenManagementPrincipal(principal(via, 'token-id')))
	}
	assert.throws(() => requireTokenManagementPrincipal(principal('kody_api_token')))
})
