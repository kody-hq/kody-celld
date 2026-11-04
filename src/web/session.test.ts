import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { Env } from '../env.ts'
import { requireWebSession } from './session.ts'

test('rejected browser cookies expire with the right scope on protected routes', async () => {
	for (const protocol of ['http', 'https']) {
		const origin = `${protocol}://fixture.example.invalid`
		const secure = protocol === 'https'
		const name = secure ? '__Host-kody_session' : 'kody_session'
		const operator = secure ? '__Host-kody_console' : 'kody_console'
		const id = randomUUID()
		const calls: Array<{ id: string; ttlMs: number }> = []
		const env = {
			KODY_PUBLIC_URL: origin,
			REGISTRY: {
				getByName: () => ({
					sessionResolve: async (raw: string, ttlMs: number) => {
						calls.push({ id: raw, ttlMs })
						return null
					},
				}),
			},
		} as unknown as Env
		const response = await requireWebSession(
			new Request(`${origin}/account/secrets?flash=saved`, {
				headers: { cookie: `${name}=${id}; ${operator}=${randomUUID()}` },
			}),
			env,
		)
		assert.ok(response instanceof Response)
		assert.equal(response.status, 303)
		assert.equal(response.headers.get('cache-control'), 'no-store')
		assert.equal(
			response.headers.get('location'),
			'/signin?flash=signin_required&next=%2Faccount%2Fsecrets%3Fflash%3Dsaved',
		)
		assert.equal(
			response.headers.get('set-cookie'),
			`${name}=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`,
		)
		assert.deepEqual(calls, [{ id, ttlMs: 30 * 24 * 60 * 60 * 1000 }])
	}
})

test('a request without the expected cookie cannot expire an ambient browser session', async () => {
	const requests = [
		new Request('https://fixture.example.invalid/account/secrets', {
			method: 'POST',
			headers: { origin: 'https://other.example.invalid', 'sec-fetch-site': 'cross-site' },
		}),
		new Request('https://fixture.example.invalid/account/secrets', {
			headers: { cookie: `__Host-kody_console=${randomUUID()}; kody_session=${randomUUID()}` },
		}),
		new Request('http://fixture.example.invalid/connect/secret-set?name=fixture', {
			headers: { cookie: `kody_console=${randomUUID()}; __Host-kody_session=${randomUUID()}` },
		}),
	]
	for (const request of requests) {
		let resolutions = 0
		const env = {
			KODY_PUBLIC_URL: new URL(request.url).origin,
			REGISTRY: {
				getByName: () => ({
					sessionResolve: async () => {
						resolutions++
						return null
					},
				}),
			},
		} as unknown as Env
		const response = await requireWebSession(request, env)
		assert.ok(response instanceof Response)
		assert.equal(response.status, 303)
		assert.equal(response.headers.get('set-cookie'), null)
		assert.equal(resolutions, 0)
	}
})

test('a valid session keeps its lifetime and remains usable for CSRF validation', async () => {
	const id = randomUUID()
	const resolved = {
		user: { id: 'fixture-user', email: 'fixture@example.invalid', createdAt: '2026-01-01T00:00:00Z' },
		session: {
			id,
			userId: 'fixture-user',
			createdAt: '2026-01-01T00:00:00Z',
			lastSeenAt: '2026-01-01T00:00:00Z',
			expiresAt: '2030-01-01T00:00:00Z',
			userAgent: null,
		},
	}
	const calls: Array<{ id: string; ttlMs: number }> = []
	const env = {
		KODY_PUBLIC_URL: 'http://fixture.example.invalid',
		KODY_MASTER_KEY: randomBytes(32).toString('hex'),
		REGISTRY: {
			getByName: () => ({
				sessionResolve: async (raw: string, ttlMs: number) => {
					calls.push({ id: raw, ttlMs })
					return resolved
				},
			}),
		},
	} as unknown as Env
	const session = await requireWebSession(
		new Request(`${env.KODY_PUBLIC_URL}/account/secrets`, {
			headers: { cookie: `kody_session=${id}` },
		}),
		env,
	)
	assert.ok(!(session instanceof Response))
	assert.deepEqual(session.user, resolved.user)
	assert.deepEqual(session.session, resolved.session)
	assert.match(session.csrf, /^[a-f0-9]{40}$/)
	assert.deepEqual(calls, [{ id, ttlMs: 30 * 24 * 60 * 60 * 1000 }])
})

test('a registry outage propagates instead of being misread as revocation', async () => {
	const origin = 'http://fixture.example.invalid'
	const error = new Error('Fixture registry unavailable')
	const env = {
		KODY_PUBLIC_URL: origin,
		REGISTRY: {
			getByName: () => ({
				sessionResolve: async () => {
					throw error
				},
			}),
		},
	} as unknown as Env
	await assert.rejects(
		requireWebSession(
			new Request(`${origin}/account/secrets`, {
				headers: { cookie: `kody_session=${randomUUID()}` },
			}),
			env,
		),
		error,
	)
})
