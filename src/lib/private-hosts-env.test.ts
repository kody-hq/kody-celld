import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	assertNoRemovedPrivateHostEnv,
	privateHostsEnvKey,
	privateHostsFromEnv,
	removedPrivateHostEnvKeys,
	warnUnusedDnsResolverEnv,
} from './private-hosts-env.ts'

describe('privateHostsFromEnv', () => {
	it('parses KODY_PRIVATE_HOSTS', () => {
		assert.deepEqual(privateHostsFromEnv({ KODY_PRIVATE_HOSTS: ' ha.home ,172.30.0.0/16,' }), [
			'ha.home',
			'172.30.0.0/16',
		])
		assert.deepEqual(privateHostsFromEnv({}), [])
	})
	it('ignores the obsolete DNS setting even when empty', () => {
		for (const value of ['', 'https://resolver.example/']) {
			assert.deepEqual(privateHostsFromEnv({ KODY_DNS_RESOLVER_URL: value, KODY_PRIVATE_HOSTS: 'ha.home' }), [
				'ha.home',
			])
		}
	})
	it('warns at startup only when the obsolete DNS setting is present', (t) => {
		const warning = t.mock.method(console, 'warn', () => {})
		warnUnusedDnsResolverEnv({})
		assert.equal(warning.mock.callCount(), 0)
		for (const value of ['', 'https://resolver.example/']) {
			warning.mock.resetCalls()
			warnUnusedDnsResolverEnv({ KODY_DNS_RESOLVER_URL: value })
			assert.equal(warning.mock.callCount(), 1)
			assert.match(
				String(warning.mock.calls[0]?.arguments[0]),
				/KODY_DNS_RESOLVER_URL is no longer used.*system resolver.*outbound policy/,
			)
		}
	})
	it('refuses each removed variable and points at the notice issue', () => {
		for (const key of removedPrivateHostEnvKeys) {
			assert.throws(
				() => assertNoRemovedPrivateHostEnv({ [key]: '' }),
				new RegExp(`${key}.*${privateHostsEnvKey}.*issues/62`),
			)
			assert.throws(() => privateHostsFromEnv({ [key]: 'localhost', KODY_PRIVATE_HOSTS: 'ha.home' }), /issues\/62/)
		}
	})
})
