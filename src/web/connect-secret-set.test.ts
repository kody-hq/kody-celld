import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Env } from '../env.ts'
import { KodyError } from '../lib/errors.ts'
import { csrfToken, serializeCookie, sessionCookieName } from '../auth/cookies.ts'
import { handleConnectSecretSet, parseConnectSecretSetQuery } from './connect-secret-set.ts'

const sessionId = 'connect-secret-set-session'

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

async function fixture() {
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
		KODY_PUBLIC_URL: 'http://localhost',
		REGISTRY: { getByName: () => registry },
		USER: { getByName: () => userCell },
	} as unknown as Env
	const cookie = await serializeCookie(sessionCookieName(false), sessionId, {
		maxAgeSeconds: 3600,
		secure: false,
	})
	const csrf = await csrfToken(env.KODY_MASTER_KEY, sessionId)
	return { env, cookie: cookie.split(';')[0] ?? '', csrf, calls }
}

function postRequest(path: string, cookie: string, fields: Record<string, string>) {
	return new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: {
			cookie,
			origin: 'http://localhost',
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

	it('saves, approves hosts, and audits without exposing the value', async () => {
		const { env, cookie, csrf, calls } = await fixture()
		const path =
			'/connect/secret-set?name=github&description=team%20token&scope=package&packageId=acme%2Fagent&allowedHosts=api.example.com'
		const request = postRequest(path, cookie, { value: 'secret-value', csrf })
		const response = await handleConnectSecretSet(request, env, new URL(request.url))

		assert.equal(response.status, 303)
		const location = response.headers.get('location') ?? ''
		assert.equal(new URL(location, 'http://localhost').searchParams.get('flash'), 'saved')
		assert.equal(location.includes('secret-value'), false)
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
