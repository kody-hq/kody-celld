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

const principal = (via: Principal['via'], apiTokenId?: string) => ({ via, apiTokenId }) as Principal

test('device token operation rejects kc_ and kody_at_ principals', () => {
	assert.throws(
		() => requireCliLoginOAuthPrincipal(principal('api_token')),
		(error: Error) => {
			assert.equal(error.message, cliLoginDeviceTokenMessage)
			return true
		},
	)
	assert.throws(
		() => requireCliLoginOAuthPrincipal(principal('kody_api_token', 'token-id')),
		(error: Error) => {
			assert.equal(error.message, cliLoginDeviceTokenMessage)
			return true
		},
	)
	assert.doesNotThrow(() => requireCliLoginOAuthPrincipal(principal('oauth')))
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
