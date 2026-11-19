import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import http from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { createEgressForwarder } from './egress-forwarder.mjs'
import { egressTargetHeader, egressErrorHeader, egressRefusedStatus } from '../src/lib/egress-protocol.ts'

async function listen(t, server) {
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	t.after(
		() =>
			new Promise((resolve) => {
				server.closeAllConnections()
				server.close(resolve)
			}),
	)
	return `http://127.0.0.1:${server.address().port}`
}

function send(origin, target, init = {}, path = '/fetch') {
	return fetch(origin + path, {
		...init,
		headers: { ...init.headers, [egressTargetHeader]: target },
		redirect: 'manual',
	})
}

test('private answers in either family are refused before opening an upstream request', async (t) => {
	const origin = await listen(t, createEgressForwarder({}))
	const lookup = t.mock.method(dns, 'lookup')
	const request = t.mock.method(http, 'request', () => {
		throw new Error('must not connect')
	})
	for (const address of [
		'10.0.0.5',
		'127.0.0.1',
		'169.254.169.254',
		'100.64.0.1',
		'::1',
		'fd00::1',
		'::ffff:a00:5',
		'::ffff:127.0.0.1',
		'64:ff9b::a00:1',
	]) {
		lookup.mock.mockImplementation(async () => [{ address, family: address.includes(':') ? 6 : 4 }])
		const response = await send(origin, 'http://public.example/')
		assert.equal(response.status, egressRefusedStatus, address)
		assert.equal(response.headers.get(egressErrorHeader), 'refused')
		assert.match((await response.json()).message, /private address/)
	}
	lookup.mock.mockImplementation(async () => [
		{ address: '93.184.216.34', family: 4 },
		{ address: '10.0.0.5', family: 4 },
	])
	assert.equal((await send(origin, 'http://public.example/')).status, egressRefusedStatus)
	assert.equal(request.mock.callCount(), 0)
})

test('connect uses the validated address and a later private answer is refused', async (t) => {
	const seen = []
	const upstream = await listen(
		t,
		http.createServer((request, response) => {
			seen.push(request.headers.host)
			response.end('ok')
		}),
	)
	const origin = await listen(t, createEgressForwarder({}))
	let lookups = 0
	t.mock.method(dns, 'lookup', async () => [{ address: ++lookups === 1 ? '93.184.216.34' : '10.0.0.5', family: 4 }])
	const request = http.request
	const pinned = []
	t.mock.method(http, 'request', (url, options) => {
		assert.equal(url.hostname, 'public.example')
		options.lookup(url.hostname, { all: true }, (error, addresses) => {
			assert.equal(error, null)
			pinned.push(...addresses.map((entry) => entry.address))
		})
		return request(upstream, { ...options, lookup: undefined })
	})
	assert.equal(await (await send(origin, 'http://public.example/path')).text(), 'ok')
	assert.equal(lookups, 1)
	assert.deepEqual(pinned, ['93.184.216.34'])
	assert.deepEqual(seen, ['public.example'])
	assert.equal((await send(origin, 'http://public.example/path')).status, egressRefusedStatus)
	assert.equal(lookups, 2)
	assert.deepEqual(pinned, ['93.184.216.34'])
})

test('allowlisted private names and ranges pass with original headers and streamed bytes', async (t) => {
	let received
	const upstream = await listen(
		t,
		http.createServer(async (request, response) => {
			const chunks = []
			for await (const chunk of request) chunks.push(chunk)
			received = {
				method: request.method,
				host: request.headers.host,
				auth: request.headers.authorization,
				target: request.headers[egressTargetHeader],
				body: Buffer.concat(chunks),
			}
			response.writeHead(201, { 'x-upstream': 'yes', [egressErrorHeader]: 'refused' })
			response.write('first')
			response.end('second')
		}),
	)
	t.mock.method(dns, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }])
	const port = new URL(upstream).port
	for (const allowed of ['allowed.example', '127.0.0.0/8']) {
		const origin = await listen(t, createEgressForwarder({ KODY_PRIVATE_HOSTS: allowed }))
		const payload = new Uint8Array([0, 255, 1, 2])
		const response = await send(origin, `http://allowed.example:${port}/body`, {
			method: 'POST',
			headers: { authorization: 'Bearer fixture' },
			body: payload,
		})
		assert.equal(response.status, 201)
		assert.equal(response.headers.get('x-upstream'), 'yes')
		assert.equal(response.headers.get(egressErrorHeader), null)
		assert.equal(await response.text(), 'firstsecond')
		assert.deepEqual(received, {
			method: 'POST',
			host: `allowed.example:${port}`,
			auth: 'Bearer fixture',
			target: undefined,
			body: Buffer.from(payload),
		})
	}
})

test('redirects are returned without following and browser resolution never connects', async (t) => {
	const upstream = await listen(
		t,
		http.createServer((_request, response) => {
			response.writeHead(302, { location: 'http://unlisted.example/' }).end()
		}),
	)
	const origin = await listen(t, createEgressForwarder({ KODY_PRIVATE_HOSTS: '127.0.0.1' }))
	const response = await send(origin, upstream)
	assert.equal(response.status, 302)
	assert.equal(response.headers.get('location'), 'http://unlisted.example/')
	const request = t.mock.method(http, 'request', () => {
		throw new Error('must not connect')
	})
	assert.equal((await send(origin, upstream, { method: 'POST' }, '/resolve')).status, 204)
	assert.equal(request.mock.callCount(), 0)
})

test('failed, empty, invalid and mixed resolutions fail closed', async (t) => {
	const origin = await listen(t, createEgressForwarder({}))
	const lookup = t.mock.method(dns, 'lookup')
	for (const answer of [[], [{ address: 'not-an-ip', family: 4 }], null]) {
		lookup.mock.mockImplementation(async () => {
			if (answer === null) throw new Error('lookup unavailable')
			return answer
		})
		const response = await send(origin, 'http://public.example/')
		assert.equal(response.status, egressRefusedStatus)
		assert.match((await response.json()).message, /Could not resolve/)
	}
	for (const url of ['not-a-url', 'file:///example', 'http://user:pass@public.example/', 'http://127.0.0.1/']) {
		assert.equal((await send(origin, url)).status, egressRefusedStatus)
	}
	assert.equal((await fetch(origin + '/unknown')).status, 404)
	assert.equal((await fetch(origin + '/health')).status, 204)
	assert.equal((await fetch(origin + '/fetch')).status, egressRefusedStatus)
})

test('IPv4-mapped IPv6 follows the IPv4 allowance', async (t) => {
	const upstream = await listen(
		t,
		http.createServer((_request, response) => response.end('mapped')),
	)
	const origin = await listen(t, createEgressForwarder({ KODY_PRIVATE_HOSTS: '127.0.0.0/8' }))
	const response = await send(origin, `http://[::ffff:127.0.0.1]:${new URL(upstream).port}/`)
	assert.equal(await response.text(), 'mapped')
})
