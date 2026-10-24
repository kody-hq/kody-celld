import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { browserConfigFromEnv, describeBrowserConfig } from './config.ts'
import { assertRenderableUrl, htmlTitle, htmlToText } from './providers.ts'

const browserless = browserConfigFromEnv({
	KODY_BROWSER_PROVIDER: 'browserless',
	KODY_BROWSER_URL: 'http://browserless:3000/',
})

describe('browser config', () => {
	it('is off by default and validates browserless', () => {
		assert.equal(browserConfigFromEnv({}), null)
		assert.deepEqual(describeBrowserConfig(null), { provider: 'none', configured: false })
		assert.equal(browserless?.baseUrl, 'http://browserless:3000')
		assert.equal(browserless?.token, null)
		assert.throws(() => browserConfigFromEnv({ KODY_BROWSER_PROVIDER: 'puppeteer' }), /expected none or browserless/)
		assert.throws(() => browserConfigFromEnv({ KODY_BROWSER_PROVIDER: 'browserless' }), /KODY_BROWSER_URL is required/)
		assert.throws(
			() => browserConfigFromEnv({ KODY_BROWSER_PROVIDER: 'cloudflare', KODY_BROWSER_TOKEN: 't' }),
			/cloudflare was removed/,
		)
		assert.throws(
			() => browserConfigFromEnv({ KODY_BROWSER_CF_ACCOUNT_ID: 'acc' }),
			/KODY_BROWSER_CF_ACCOUNT_ID was removed/,
		)
		assert.throws(
			() =>
				browserConfigFromEnv({
					KODY_BROWSER_PROVIDER: 'browserless',
					KODY_BROWSER_URL: 'http://x',
					KODY_BROWSER_TIMEOUT_MS: '10',
				}),
			/between 1000 and 300000/,
		)
	})

	it('rejects an invalid private-host entry, naming it', () => {
		assert.throws(
			() =>
				browserConfigFromEnv({
					KODY_BROWSER_PROVIDER: 'browserless',
					KODY_BROWSER_URL: 'http://b:3000',
					KODY_PRIVATE_HOSTS: 'ok.home,10.0.0.0/99',
				}),
			/KODY_PRIVATE_HOSTS: "10\.0\.0\.0\/99"/,
		)
	})

	it('describes the browserless provider without the token', () => {
		const config = browserConfigFromEnv({
			KODY_BROWSER_PROVIDER: 'browserless',
			KODY_BROWSER_URL: 'http://browserless:3000',
			KODY_BROWSER_TOKEN: 'unit-test-token-not-real',
			KODY_PRIVATE_HOSTS: 'Dash.Home.LAN, *.lab.internal',
		})
		assert.equal(config?.baseUrl, 'http://browserless:3000')
		assert.deepEqual(config?.allowPrivateHosts, ['dash.home.lan', '*.lab.internal'])
		const described = JSON.stringify(describeBrowserConfig(config))
		assert.doesNotMatch(described, /unit-test-token-not-real/)
		assert.match(described, /"hasToken":true/)
	})
})

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

describe('assertRenderableUrl', () => {
	const config = browserless!
	afterEach(() => mock.restoreAll())
	/** The DoH lookup uses the global fetch; answer it from `dns`. */
	const check = (url: string, cfg = config, dns = dohStub()) => {
		mock.method(globalThis, 'fetch', dns)
		return assertRenderableUrl(url, cfg)
	}

	it('accepts public http(s) URLs only', async () => {
		assert.equal(await check('https://example.com/page?q=1'), 'https://example.com/page?q=1')
		assert.equal(await check('http://[2001:db8::1]/'), 'http://[2001:db8::1]/')
		await assert.rejects(check('ftp://example.com'), /Only http\(s\)/)
		await assert.rejects(check('file:///etc/hosts'), /Only http\(s\)/)
		await assert.rejects(check('https://user:pw@example.com'), /embedded credentials/)
		await assert.rejects(check('nope'), /not a valid URL/)
		await assert.rejects(check(''), /non-empty/)
	})

	it('refuses loopback, private and single-label hosts unless allowlisted', async () => {
		for (const url of [
			'http://localhost:8787/',
			'http://kody.localhost/',
			'http://127.0.0.1/',
			'http://10.1.2.3/',
			'http://172.16.0.1/',
			'http://192.168.1.1/',
			'http://169.254.169.254/latest/meta-data',
			'http://100.64.0.1/',
			'http://0.0.0.0/',
			'http://[::1]/',
			'http://[fe80::1]/',
			'http://[fd00::1]/',
			'http://[::ffff:10.0.0.1]/',
			'http://minio:9000/',
			'http://qdrant.internal/',
			'http://nas.local/',
		]) {
			await assert.rejects(check(url), /browser_private_host/, url)
		}
		const allowing = { ...config, allowPrivateHosts: ['localhost', '*.home.lan', '192.168.1.10'] }
		assert.equal(await check('http://localhost:8787/x', allowing), 'http://localhost:8787/x')
		assert.equal(await check('http://dash.home.lan/', allowing), 'http://dash.home.lan/')
		assert.equal(await check('http://192.168.1.10/', allowing), 'http://192.168.1.10/')
		await assert.rejects(check('http://192.168.1.11/', allowing), /browser_private_host/)
		const cidr = { ...config, allowPrivateHosts: ['172.30.0.0/16'] }
		assert.equal(await check('http://172.30.1.108:8123/', cidr), 'http://172.30.1.108:8123/')
		await assert.rejects(check('http://172.31.0.1/', cidr), /browser_private_host/)
	})

	it('resolves the hostname and refuses private answers', async () => {
		for (const address of [
			'192.168.1.1',
			'127.0.0.1',
			'169.254.169.254',
			'100.100.100.100',
			'::1',
			'fe80::1',
			'::ffff:7f00:1',
		]) {
			await assert.rejects(
				check('https://public.example/', config, dohStub({ 'public.example': [address] })),
				(error: Error) => {
					assert.equal(error.name, 'KodyError:browser_private_host:403')
					assert.ok(error.message.includes(address), address)
					return true
				},
			)
		}
		await assert.rejects(check('https://public.example/', config, dohStub({}, [])), /Could not resolve/)
	})

	it('allows a private answer inside a KODY_PRIVATE_HOSTS range and skips the lookup for listed names', async () => {
		const dns = dohStub({ 'ha.example': ['172.30.1.108'] })
		const cfg = { ...config, allowPrivateHosts: ['172.30.0.0/16', 'dash.example'] }
		assert.equal(await check('http://ha.example:8123/', cfg, dns), 'http://ha.example:8123/')
		assert.equal(await check('http://dash.example/', cfg, dns), 'http://dash.example/')
		assert.deepEqual(dns.queries.sort(), ['ha.example/A', 'ha.example/AAAA'])
	})

	it('reads KODY_DNS_RESOLVER_URL', () => {
		assert.equal(config.dnsResolverUrl, 'https://cloudflare-dns.com/dns-query')
		const env = { KODY_BROWSER_PROVIDER: 'browserless', KODY_BROWSER_URL: 'http://browserless:3000' }
		assert.equal(
			browserConfigFromEnv({ ...env, KODY_DNS_RESOLVER_URL: 'https://dns.lan/q' })?.dnsResolverUrl,
			'https://dns.lan/q',
		)
		assert.throws(
			() => browserConfigFromEnv({ ...env, KODY_DNS_RESOLVER_URL: 'http://dns.lan/q' }),
			/KODY_DNS_RESOLVER_URL/,
		)
	})
})

describe('html helpers', () => {
	it('extracts title and visible text', () => {
		const html = `<html><head><title> Hello &amp; welcome </title><style>p{}</style></head>
<body><script>var x = 1</script><h1>Kody</h1><p>Self-hosted<br>core</p><!-- hidden --><div>&nbsp;ok</div></body></html>`
		assert.equal(htmlTitle(html), 'Hello & welcome')
		assert.equal(htmlToText(html), 'Kody\nSelf-hosted\ncore\nok')
		assert.equal(htmlTitle('<p>no title</p>'), null)
	})
})
