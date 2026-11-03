import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { forwardedOperatorVars } from './fleet-vars.mjs'

describe('forwardedOperatorVars', () => {
	it('forwards the package app origin and secret provider settings', () => {
		assert.deepEqual(
			forwardedOperatorVars({
				KODY_APP_BASE_URL: 'https://*.apps.example.com',
				KODY_SECRET_PROVIDER_TIMEOUT_MS: '5000',
				KODY_SECRET_PROVIDER_CACHE_SECONDS: '0',
			}),
			{
				KODY_APP_BASE_URL: 'https://*.apps.example.com',
				KODY_SECRET_PROVIDER_TIMEOUT_MS: '5000',
				KODY_SECRET_PROVIDER_CACHE_SECONDS: '0',
			},
		)
	})

	it('keeps forwarding the runtime limit prefixes', () => {
		assert.deepEqual(forwardedOperatorVars({ KODY_EXECUTE_TIMEOUT_MS: '1000', KODY_QUOTA_SECRETS: '10' }), {
			KODY_EXECUTE_TIMEOUT_MS: '1000',
			KODY_QUOTA_SECRETS: '10',
		})
	})

	it('drops empty values and unrelated variables', () => {
		assert.deepEqual(
			forwardedOperatorVars({
				KODY_APP_BASE_URL: '',
				KODY_SECRET_PROVIDER_TIMEOUT_MS: undefined,
				KODY_SECRET_PROVIDER_EXTRA: '1',
				KODY_APP_BASE_URL_EXTRA: 'x',
				PATH: '/usr/bin',
			}),
			{},
		)
	})
})
