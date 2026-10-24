import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Env } from '../env.ts'
import { KodyError } from '../lib/errors.ts'
import { canonicalJsonStringify } from '../lib/canonical-json.ts'
import { sha256Hex } from '../lib/crypto.ts'
import { cookiesAreSecure, csrfToken, serializeCookie, sessionCookieName } from '../auth/cookies.ts'
import { connectSecretSetSavedState, handleConnectSecretSet, parseConnectSecretSetQuery } from './connect-secret-set.ts'
import type { ConnectSecretSetPageData } from './connect-secret-set.ts'

const sessionId = 'connect-secret-set-session'

type SavedSetup = Pick<ConnectSecretSetPageData, 'name' | 'scope' | 'packageId' | 'description' | 'hosts'>

function setupFromUrl(url: URL): SavedSetup {
	const parsed = parseConnectSecretSetQuery(url)
	if (parsed.kind !== 'setup') throw new Error('Expected a setup URL.')
	return parsed.setup
}

async function savedCookieValue(userId: string, setup: SavedSetup) {
	return sha256Hex(
		canonicalJsonStringify({
			userId,
			name: setup.name,
			scope: setup.scope,
			packageId: setup.packageId,
			description: setup.description,
			hosts: [...setup.hosts].sort(),
		}),
	)
}

function userCellStub(calls: {
	saves: Array<Record<string, unknown>>
	approvals: Array<{ host: string; approvedBy: string }>
}) {
	return {
		init: async (_userId: string) => {},
		secretSave: async (input: Record<string, unknown>) => {
			calls.saves.push(input)
			return {}
		},
		secretHostApprove: async (input: { host: string; approvedBy: string }) => {
			calls.approvals.push(input)
			return { host: input.host, approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: input.approvedBy }
		},
	}
}

async function fixture(publicUrl = 'http://localhost') {
	const calls = {
		saves: [] as Array<Record<string, unknown>>,
		approvals: [] as Array<{ host: string; approvedBy: string }>,
		audits: [] as Array<Record<string, unknown>>,
	}
	const userCell = userCellStub(calls)
	const registry = {
		sessionResolve: async (id: string) =>
			id === sessionId
				? {
						user: { id: 'user-1', email: 'owner@example.com', createdAt: '2026-01-01T00:00:00.000Z' },
						session: { id: sessionId },
					}
				: null,
		auditAppend: async (entry: Record<string, unknown>) => {
			calls.audits.push(entry)
			return { id: 'audit-1', at: '2026-01-01T00:00:00.000Z' }
		},
	}
	const env = {
		KODY_MASTER_KEY: 'test-master-key',
		KODY_PUBLIC_URL: publicUrl,
		REGISTRY: { getByName: () => registry },
		USER: { getByName: () => userCell },
	} as unknown as Env
	const secure = cookiesAreSecure(publicUrl)
	const cookie = await serializeCookie(sessionCookieName(secure), sessionId, {
		maxAgeSeconds: 3600,
		secure,
	})
	const csrf = await csrfToken(env.KODY_MASTER_KEY, sessionId)
	return { env, cookie: cookie.split(';')[0] ?? '', csrf, calls }
}

function postRequest(path: string, cookie: string, fields: Record<string, string>, origin = 'http://localhost') {
	return new Request(`${origin}${path}`, {
		method: 'POST',
		headers: {
			cookie,
			origin,
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(fields),
	})
}

describe('parseConnectSecretSetQuery', () => {
	it('reports a missing name so the route can return to account secrets', () => {
		assert.deepEqual(parseConnectSecretSetQuery(new URL('http://localhost/connect/secret-set')), {
			kind: 'missing_name',
		})
	})

	it('requires packageId for package scope', () => {
		const parsed = parseConnectSecretSetQuery(new URL('http://localhost/connect/secret-set?name=github&scope=package'))
		assert.equal(parsed.kind, 'setup')
		if (parsed.kind === 'setup') assert.equal(parsed.error, 'Package scope requires packageId.')
	})

	it('rejects malformed hosts', () => {
		const parsed = parseConnectSecretSetQuery(
			new URL('http://localhost/connect/secret-set?name=github&allowedHosts=api.example.com%2Fpath'),
		)
		assert.equal(parsed.kind, 'setup')
		if (parsed.kind === 'setup') {
			assert.match(parsed.error ?? '', /must not contain a scheme or path/)
			assert.deepEqual(parsed.setup.hosts, ['api.example.com/path'])
		}
	})

	it('shows a note for unsupported expiry and package grants', () => {
		const parsed = parseConnectSecretSetQuery(
			new URL('http://localhost/connect/secret-set?name=github&expiresAt=2026-12-01&allowedPackages=acme%2Fbot'),
		)
		assert.equal(parsed.kind, 'setup')
		if (parsed.kind === 'setup') {
			assert.match(parsed.setup.unsupportedNote ?? '', /does not support expiresAt or allowedPackages/)
			assert.equal(parsed.error, null)
		}
	})

	it('rejects an unsupported scope', () => {
		const parsed = parseConnectSecretSetQuery(new URL('http://localhost/connect/secret-set?name=github&scope=team'))
		assert.equal(parsed.kind, 'setup')
		if (parsed.kind === 'setup') assert.equal(parsed.error, 'Scope must be user or package.')
	})
})

describe('handleConnectSecretSet', () => {
	it('redirects a signed-out owner with the complete query string as the return path', async () => {
		const { env } = await fixture()
		const url = new URL('http://localhost/connect/secret-set?name=github&description=team%20token')
		const response = await handleConnectSecretSet(new Request(url), env, url)
		assert.equal(response.status, 303)
		assert.equal(
			new URL(response.headers.get('location') ?? '', 'http://localhost').searchParams.get('next'),
			url.pathname + url.search,
		)
	})

	it('redirects a signed-in owner to account secrets when name is absent', async () => {
		const { env, cookie } = await fixture()
		const request = new Request('http://localhost/connect/secret-set', { headers: { cookie } })
		const response = await handleConnectSecretSet(request, env, new URL(request.url))
		assert.equal(response.status, 303)
		assert.equal(response.headers.get('location'), '/account/secrets')
	})

	it('ignores flash=saved when no matching saved cookie is present', async () => {
		const { cookie } = await fixture()
		const url = new URL('http://localhost/connect/secret-set?name=github&flash=saved')
		const request = new Request(url, {
			headers: { cookie },
		})
		assert.deepEqual(await connectSecretSetSavedState(request, 'user-1', setupFromUrl(url)), {
			saved: false,
			canSubmit: true,
			clearCookie: null,
		})
	})

	it('shows the saved state for a matching cookie and clears it', async () => {
		const { cookie } = await fixture()
		const url = new URL(
			'http://localhost/connect/secret-set?name=GitHub%20token&allowedHosts=API.TWO.EXAMPLE%2CAPI.ONE.EXAMPLE',
		)
		const setup = setupFromUrl(url)
		const request = new Request(url, {
			headers: { cookie: `${cookie}; kody_connect_saved=${await savedCookieValue('user-1', setup)}` },
		})

		assert.deepEqual(await connectSecretSetSavedState(request, 'user-1', setup), {
			saved: true,
			canSubmit: false,
			clearCookie: 'kody_connect_saved=; HttpOnly; Max-Age=0; Path=/connect/secret-set; SameSite=Lax',
		})
	})

	it('shows the form and clears a saved cookie for a different name', async () => {
		const { cookie } = await fixture()
		const url = new URL('http://localhost/connect/secret-set?name=github')
		const setup = setupFromUrl(url)
		const mismatchedValue = await savedCookieValue('user-1', { ...setup, name: 'other' })
		const request = new Request(url, {
			headers: { cookie: `${cookie}; kody_connect_saved=${mismatchedValue}` },
		})

		assert.deepEqual(await connectSecretSetSavedState(request, 'user-1', setup), {
			saved: false,
			canSubmit: true,
			clearCookie: 'kody_connect_saved=; HttpOnly; Max-Age=0; Path=/connect/secret-set; SameSite=Lax',
		})
	})

	it('does not confirm the same name when allowedHosts differ', async () => {
		const { cookie } = await fixture()
		const savedSetup = setupFromUrl(
			new URL('http://localhost/connect/secret-set?name=github&allowedHosts=api.one.example'),
		)
		const currentUrl = new URL('http://localhost/connect/secret-set?name=github&allowedHosts=api.two.example')
		const currentSetup = setupFromUrl(currentUrl)
		const request = new Request(currentUrl, {
			headers: { cookie: `${cookie}; kody_connect_saved=${await savedCookieValue('user-1', savedSetup)}` },
		})

		assert.deepEqual(await connectSecretSetSavedState(request, 'user-1', currentSetup), {
			saved: false,
			canSubmit: true,
			clearCookie: 'kody_connect_saved=; HttpOnly; Max-Age=0; Path=/connect/secret-set; SameSite=Lax',
		})
	})

	it('does not confirm a cookie created for a different user', async () => {
		const { cookie } = await fixture()
		const url = new URL('http://localhost/connect/secret-set?name=github')
		const setup = setupFromUrl(url)
		const request = new Request(url, {
			headers: { cookie: `${cookie}; kody_connect_saved=${await savedCookieValue('user-a', setup)}` },
		})

		assert.deepEqual(await connectSecretSetSavedState(request, 'user-b', setup), {
			saved: false,
			canSubmit: true,
			clearCookie: 'kody_connect_saved=; HttpOnly; Max-Age=0; Path=/connect/secret-set; SameSite=Lax',
		})
	})

	it('saves, approves hosts, and audits without exposing the value', async () => {
		const { env, cookie, csrf, calls } = await fixture('https://localhost')
		const path =
			'/connect/secret-set?name=github&description=team%20token&scope=package&packageId=acme%2Fagent&allowedHosts=api.example.com&flash=saved'
		const request = postRequest(path, cookie, { value: 'secret-value', csrf }, 'https://localhost')
		const response = await handleConnectSecretSet(request, env, new URL(request.url))
		const expectedCookieValue = await savedCookieValue('user-1', setupFromUrl(new URL(request.url)))

		assert.equal(response.status, 303)
		const location = response.headers.get('location') ?? ''
		assert.equal(new URL(location, 'https://localhost').searchParams.has('flash'), false)
		assert.equal(location.includes('secret-value'), false)
		assert.equal(
			response.headers.get('set-cookie'),
			`kody_connect_saved=${expectedCookieValue}; HttpOnly; Max-Age=60; Path=/connect/secret-set; SameSite=Lax; Secure`,
		)
		assert.deepEqual(calls.saves, [
			{
				name: 'github',
				value: 'secret-value',
				description: 'team token',
				scope: 'package',
				packageName: 'acme/agent',
			},
		])
		assert.deepEqual(calls.approvals, [{ host: 'api.example.com', approvedBy: 'owner' }])
		const saveAudit = calls.audits.find((entry) => entry.action === 'secret.save')
		assert.equal(saveAudit?.target, 'github')
		assert.deepEqual(saveAudit?.details, { via: 'connect' })
		assert.equal(JSON.stringify(calls.audits).includes('secret-value'), false)
	})

	it('rejects a missing CSRF token before saving', async () => {
		const { env, cookie, calls } = await fixture()
		const request = postRequest('/connect/secret-set?name=github', cookie, { value: 'secret-value' })
		await assert.rejects(
			handleConnectSecretSet(request, env, new URL(request.url)),
			(error: unknown) => KodyError.fromUnknown(error)?.code === 'csrf_mismatch',
		)
		assert.deepEqual(calls.saves, [])
	})
})
