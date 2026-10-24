import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KodyError } from './errors.ts'
import { assertResolvedHostAllowed, dnsResolverUrlFromEnv, type DnsMemo } from './resolved-host-guard.ts'

const policy = { allowPrivateHosts: ['172.30.0.0/16', 'nas.example'], dnsResolverUrl: 'https://dns.test/dns-query' }

/** Answers DNS-over-HTTPS JSON lookups from `answers` (unlisted names: `fallback`) and records them. */
function dohStub(answers: Record<string, Array<string>> = {}, fallback = ['93.184.216.34']) {
	const queries: Array<string> = []
	const stub = async (input: RequestInfo | URL) => {
		const url = new URL(String(input))
		const name = url.searchParams.get('name') ?? ''
		const type = url.searchParams.get('type')
		queries.push(`${name}/${type}`)
		const addresses = answers[name] ?? fallback
		const wanted = addresses.filter((address) => address.includes(':') === (type === 'AAAA'))
		return Response.json({ Status: 0, Answer: wanted.map((data) => ({ type: type === 'AAAA' ? 28 : 1, data })) })
	}
	return Object.assign(stub, { queries })
}

describe('dnsResolverUrlFromEnv', () => {
	it('defaults to Cloudflare and accepts https only', () => {
		assert.equal(dnsResolverUrlFromEnv({}), 'https://cloudflare-dns.com/dns-query')
		assert.equal(dnsResolverUrlFromEnv({ KODY_DNS_RESOLVER_URL: ' https://dns.lan/q ' }), 'https://dns.lan/q')
		assert.throws(() => dnsResolverUrlFromEnv({ KODY_DNS_RESOLVER_URL: 'http://dns.lan/q' }), /expected an https URL/)
		assert.throws(() => dnsResolverUrlFromEnv({ KODY_DNS_RESOLVER_URL: 'nope' }), /expected an https URL/)
	})
})

describe('assertResolvedHostAllowed (shared)', () => {
	it('refuses every private range in both families, including IPv4-mapped IPv6', async () => {
		for (const address of [
			'0.0.0.1',
			'10.1.2.3',
			'100.64.0.1',
			'127.0.0.1',
			'169.254.169.254',
			'172.16.0.1',
			'192.168.0.1',
			'::1',
			'::',
			'fc00::1',
			'fe80::1',
			'::ffff:a9fe:a9fe',
			'::ffff:127.0.0.1',
			'64:ff9b::a00:1',
			'2002:a00:1::1',
		]) {
			await assert.rejects(
				assertResolvedHostAllowed(new URL('https://a.example/'), policy, {
					fetch: dohStub({ 'a.example': [address] }),
				}),
				(error: Error) => error.message.includes(`private address ${address}`),
				address,
			)
		}
	})

	it('refuses when any one answer is private', async () => {
		await assert.rejects(
			assertResolvedHostAllowed(new URL('https://a.example/'), policy, {
				fetch: dohStub({ 'a.example': ['93.184.216.34', '2001:db8::1', '10.0.0.1'] }),
			}),
			/10\.0\.0\.1/,
		)
	})

	it('passes public answers and answers inside an allowed range', async () => {
		await assertResolvedHostAllowed(new URL('https://a.example/'), policy, {
			fetch: dohStub({ 'a.example': ['93.184.216.34', '2606:4700::1'] }),
		})
		await assertResolvedHostAllowed(new URL('https://lan.example/'), policy, {
			fetch: dohStub({ 'lan.example': ['172.30.0.9'] }),
		})
	})

	it('skips the lookup for IP literals and listed names', async () => {
		const dns = dohStub({}, ['10.0.0.1'])
		await assertResolvedHostAllowed(new URL('https://nas.example/'), policy, { fetch: dns })
		await assertResolvedHostAllowed(new URL('https://93.184.216.34/'), policy, { fetch: dns })
		await assertResolvedHostAllowed(new URL('https://[2001:db8::1]/'), policy, { fetch: dns })
		assert.deepEqual(dns.queries, [])
	})

	it('uses the caller error and memoizes successful lookups only', async () => {
		const refuse = (message: string) => new KodyError('custom_refused', message, { status: 403 })
		await assert.rejects(
			assertResolvedHostAllowed(new URL('https://a.example/'), policy, {
				fetch: dohStub({ 'a.example': ['10.0.0.1'] }),
				refuse,
			}),
			(error: Error) => error.name === 'KodyError:custom_refused:403',
		)
		const memo: DnsMemo = new Map()
		const dns = dohStub()
		await assertResolvedHostAllowed(new URL('https://a.example/'), policy, { fetch: dns, memo })
		await assertResolvedHostAllowed(new URL('https://a.example/other'), policy, { fetch: dns, memo })
		assert.equal(dns.queries.length, 2)
		const failing = (async () => new Response('', { status: 500 })) as typeof fetch
		await assert.rejects(
			assertResolvedHostAllowed(new URL('https://b.example/'), policy, { fetch: failing, memo }),
			/Could not resolve "b\.example"/,
		)
		await new Promise((resolve) => setTimeout(resolve, 0))
		assert.equal(memo.has('b.example'), false)
	})
})
