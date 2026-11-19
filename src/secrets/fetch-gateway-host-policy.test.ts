import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type { Env } from '../env.ts'

const workerModule = `export class WorkerEntrypoint {
	constructor(ctx, env) { this.ctx = ctx; this.env = env }
}
export class DurableObject {}`
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		return specifier === 'cloudflare:workers'
			? { url: `data:text/javascript,${encodeURIComponent(workerModule)}`, shortCircuit: true }
			: nextResolve(specifier, context)
	},
})
const { FetchGateway } = await import('./fetch-gateway.ts')
hooks.deregister()

const resolverOrigin = 'https://dns.test'

type Upstream = (url: URL) => Response

/**
 * Stubs global fetch: DNS-over-HTTPS lookups answer from `dns` (unlisted names resolve to a
 * public address), everything else is an upstream request recorded in `sent`.
 */
function stubNetwork(
	t: test.TestContext,
	dns: Record<string, Array<string>> = {},
	upstream: Upstream = () => new Response('ok'),
) {
	const sent: Array<string> = []
	const lookups: Array<string> = []
	t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		if (url.origin === resolverOrigin) {
			const name = url.searchParams.get('name') ?? ''
			const type = url.searchParams.get('type')
			lookups.push(`${name}/${type}`)
			const answers = (dns[name] ?? ['93.184.216.34']).filter((a) => a.includes(':') === (type === 'AAAA'))
			return Response.json({ Status: 0, Answer: answers.map((data) => ({ type: type === 'AAAA' ? 28 : 1, data })) })
		}
		sent.push(url.href)
		return upstream(url)
	})
	return { sent, lookups }
}

function makeGateway(env: Record<string, string> = {}, packageName: string | null = null) {
	const userCell = {
		async secretHostList() {
			return [{ host: 'hop.example.com' }]
		},
		async secretResolveValues() {
			return { values: { fixture: 'fixture-only' }, missing: [], locked: [] }
		},
		async runRecordGatewayEvent() {},
	}
	const fullEnv = {
		KODY_PUBLIC_URL: 'https://cell.example.test',
		KODY_DNS_RESOLVER_URL: `${resolverOrigin}/dns-query`,
		USER: { getByName: () => userCell },
		...env,
	} as unknown as Env
	const ctx = {
		props: { userId: 'fixture-user', packageName },
		waitUntil(promise: Promise<unknown>) {
			void promise.catch(() => {})
		},
	} as unknown as ExecutionContext
	return new FetchGateway(ctx, fullEnv)
}

async function assertRefused(response: Response) {
	assert.equal(response.status, 403)
	const body = (await response.json()) as { error: string; message: string }
	assert.equal(body.error, 'private_host_refused')
	assert.match(body.message, /KODY_PRIVATE_HOSTS/)
}

for (const packageName of [null, 'fixture-package']) {
	const caller = packageName === null ? 'ad hoc execute' : 'package code'
	test(`${caller}: metadata and loopback literals are refused, not forwarded`, async (t) => {
		const { sent } = stubNetwork(t)
		const gateway = makeGateway({}, packageName)
		for (const url of [
			'http://169.254.169.254/latest/meta-data/',
			'http://127.0.0.1:8787/',
			'http://localhost:8787/',
			'http://10.0.0.5/',
			'http://192.168.1.1/',
			'http://2130706433/',
			'http://0177.0.0.1/',
			'http://0x7f.1/',
			'http://0251.0376.0251.0376/latest/meta-data/',
			'http://[::1]/',
			'http://[fd00::1]/',
			'http://[fe80::1]/',
			'http://[::ffff:127.0.0.1]/',
			'http://[::ffff:a9fe:a9fe]/',
		]) {
			await assertRefused(await gateway.fetch(new Request(url)))
		}
		assert.deepEqual(sent, [])
	})
}

test('a public name that resolves to a private address is refused', async (t) => {
	const { sent } = stubNetwork(t, {
		'rebind.example.com': ['10.0.0.5'],
		'mapped.example.com': ['93.184.216.34', '::ffff:169.254.169.254'],
		'ula.example.com': ['fd12:3456::1'],
	})
	const gateway = makeGateway()
	for (const host of ['rebind.example.com', 'mapped.example.com', 'ula.example.com']) {
		await assertRefused(await gateway.fetch(new Request(`https://${host}/`)))
	}
	assert.deepEqual(sent, [])
})

test('a public host is forwarded after its lookup', async (t) => {
	const { sent, lookups } = stubNetwork(t)
	const response = await makeGateway().fetch(new Request('https://api.example.com/data'))
	assert.equal(response.status, 200)
	assert.deepEqual(sent, ['https://api.example.com/data'])
	assert.deepEqual(lookups.sort(), ['api.example.com/A', 'api.example.com/AAAA'])
})

test('every fetch resolves again, so a later rebinding answer is refused', async (t) => {
	const dns: Record<string, Array<string>> = { 'flip.example.com': ['93.184.216.34'] }
	const { sent } = stubNetwork(t, dns)
	const gateway = makeGateway()
	assert.equal((await gateway.fetch(new Request('https://flip.example.com/'))).status, 200)
	dns['flip.example.com'] = ['127.0.0.1']
	await assertRefused(await gateway.fetch(new Request('https://flip.example.com/')))
	assert.deepEqual(sent, ['https://flip.example.com/'])
})

test('a redirect into the private network is refused at that hop', async (t) => {
	for (const target of ['http://169.254.169.254/latest/meta-data/', 'https://rebind.example.com/']) {
		const { sent } = stubNetwork(t, { 'rebind.example.com': ['192.168.0.10'] }, (url) =>
			url.hostname === 'hop.example.com'
				? new Response(null, { status: 302, headers: { location: target } })
				: new Response('ok'),
		)
		await assertRefused(await makeGateway().fetch(new Request('https://hop.example.com/start')))
		assert.deepEqual(sent, ['https://hop.example.com/start'])
		t.mock.restoreAll()
	}
})

test('a redirect into the private network is refused even with a placeholder-free retry', async (t) => {
	const { sent } = stubNetwork(t, {}, (url) =>
		url.hostname === 'hop.example.com'
			? new Response(null, { status: 307, headers: { location: 'http://127.0.0.1:9000/' } })
			: new Response('ok'),
	)
	const headers = { authorization: 'Bearer ' + '{'.repeat(2) + 'secret:fixture' + '}'.repeat(2) }
	await assertRefused(await makeGateway().fetch(new Request('https://hop.example.com/start', { headers })))
	assert.deepEqual(sent, ['https://hop.example.com/start'])
})

test('KODY_PRIVATE_HOSTS is the operator opt-in for LAN hosts', async (t) => {
	const { sent } = stubNetwork(t, { 'nas.example.com': ['192.168.1.20'] })
	const gateway = makeGateway({ KODY_PRIVATE_HOSTS: '127.0.0.1,192.168.1.0/24,*.lan' })
	for (const url of ['http://127.0.0.1:8787/', 'http://printer.lan/', 'https://nas.example.com/']) {
		assert.equal((await gateway.fetch(new Request(url))).status, 200, url)
	}
	assert.deepEqual(sent, ['http://127.0.0.1:8787/', 'http://printer.lan/', 'https://nas.example.com/'])
	await assertRefused(await gateway.fetch(new Request('http://169.254.169.254/')))
})
