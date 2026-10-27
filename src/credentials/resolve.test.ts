import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { IntegrationUsage } from '../integrations/oauth.ts'
import { resolveCredentials, type CredentialCandidate } from './resolve.ts'

const secret = (
	name: string,
	scope: 'user' | 'package' = 'user',
	packageName: string | null = null,
): CredentialCandidate => ({
	kind: 'secret',
	name,
	scope,
	packageName,
	hosts: ['api.example.com'],
})
const oauth = (name: string, provider = name, usage: IntegrationUsage = { mode: 'any' }): CredentialCandidate => ({
	kind: 'oauth',
	name,
	provider,
	status: 'connected',
	usage,
	hosts: ['api.example.com'],
})
const mcp = (name: string, enabled = true, usage: IntegrationUsage = { mode: 'any' }): CredentialCandidate => ({
	kind: 'mcp',
	name,
	enabled,
	usage,
	hosts: ['mcp.example.com'],
})

const resolve = (overrides: Partial<Parameters<typeof resolveCredentials>[0]> = {}) =>
	resolveCredentials({
		key: 'github',
		packageName: '@scope/pkg',
		candidates: [],
		publicUrl: 'https://kody.example',
		...overrides,
	})

describe('resolveCredentials', () => {
	it('reports unbound credentials with an account URL', () => {
		assert.throws(
			() => resolve(),
			(error: unknown) => {
				const e = error as { code?: string; details?: Record<string, unknown> }
				return e.code === 'credential_unbound' && e.details?.createUrl === 'https://kody.example/account/secrets'
			},
		)
	})

	it('resolves a single match and honors provider aliases', () => {
		assert.deepEqual(resolve({ candidates: [oauth('work-github', 'github')] }), {
			name: 'work-github',
			scope: 'user',
			kind: 'oauth',
			hosts: ['api.example.com'],
		})
	})

	it('counts every supported kind toward ambiguity and supplies retry options', () => {
		assert.throws(
			() => resolve({ candidates: [secret('github'), oauth('github'), mcp('github')] }),
			(error: unknown) => {
				const e = error as { code?: string; details?: Record<string, unknown> }
				const options = e.details?.options
				const retryWith = e.details?.retryWith
				if (e.code !== 'credential_ambiguous' || !Array.isArray(options) || !Array.isArray(retryWith)) {
					return false
				}
				return (
					(options as Array<{ kind: string }>).map((option) => option.kind).join(',') === 'secret,oauth,mcp' &&
					(retryWith as Array<string>).includes('credential.named(name, { scope })')
				)
			},
		)
	})

	it('selects a named scope and hides package secrets owned by another run package', () => {
		const candidates = [
			secret('token'),
			secret('token', 'package', '@scope/pkg'),
			secret('token', 'package', '@other/pkg'),
		]
		assert.deepEqual(resolve({ name: 'token', scope: 'package', candidates }), {
			name: 'token',
			scope: 'package',
			kind: 'secret',
			hosts: ['api.example.com'],
		})
		assert.throws(
			() => resolve({ name: 'token', scope: 'package', candidates: [secret('token', 'package', '@other/pkg')] }),
			(error: unknown) => (error as { code?: string }).code === 'credential_unbound',
		)
	})

	it('maps personal and org named scopes to the single celld user scope', () => {
		for (const scope of ['personal', 'org']) {
			assert.deepEqual(resolve({ name: 'token', scope, candidates: [secret('token')] }), {
				name: 'token',
				scope: 'user',
				kind: 'secret',
				hosts: ['api.example.com'],
			})
			assert.deepEqual(resolve({ name: 'work', scope, candidates: [oauth('work')] }), {
				name: 'work',
				scope: 'user',
				kind: 'oauth',
				hosts: ['api.example.com'],
			})
		}
	})

	it('denies usage-locked integrations and does not match disabled MCP servers', () => {
		assert.throws(
			() => resolve({ candidates: [oauth('github', 'github', { mode: 'packages', packages: ['@other/pkg'] })] }),
			(error: unknown) => (error as { code?: string }).code === 'credential_denied',
		)
		assert.throws(
			() => resolve({ key: 'linear', candidates: [mcp('linear', false)] }),
			(error: unknown) => (error as { code?: string }).code === 'credential_unbound',
		)
	})

	it('ignores unrelated usage-locked matches when a permitted credential matches', () => {
		assert.deepEqual(
			resolve({
				key: 'github',
				candidates: [secret('github'), oauth('github', 'github', { mode: 'packages', packages: ['@other/pkg'] })],
			}),
			{ name: 'github', scope: 'user', kind: 'secret', hosts: ['api.example.com'] },
		)
	})

	it('opens pending client-credentials integrations for on-demand token refresh', () => {
		const pending = (flow?: string): CredentialCandidate => ({
			kind: 'oauth',
			name: 'service',
			provider: 'service',
			status: 'pending',
			flow,
			usage: { mode: 'any' },
			hosts: ['api.example.com'],
		})
		assert.equal(
			(resolve({ name: 'service', candidates: [pending('client_credentials')] }) as { kind: string }).kind,
			'oauth',
		)
		assert.throws(
			() => resolve({ name: 'service', candidates: [pending()] }),
			(error: unknown) => (error as { code?: string }).code === 'credential_unbound',
		)
	})

	it('returns all matches for a declared multiple slot in resolution order', () => {
		const result = resolve({
			slot: { multiple: true },
			all: true,
			candidates: [mcp('github'), oauth('github'), secret('github')],
		})
		assert.deepEqual(
			(Array.isArray(result) ? result : []).map(({ kind }) => kind),
			['secret', 'oauth', 'mcp'],
		)
	})
})
