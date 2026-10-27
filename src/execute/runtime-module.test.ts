import assert from 'node:assert/strict'
import test, { describe, it } from 'node:test'
import { RUNTIME_MODULE_SOURCE } from './runtime-module.ts'

type CredentialInfo = {
	name: string
	scope: 'user' | 'package'
	kind: 'secret' | 'oauth' | 'mcp'
	hosts: Array<string>
}

type CredentialClient = {
	fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
	callTool?: (tool: string, args?: unknown) => Promise<unknown>
}

type CredentialOpenArgs = { key?: string; name?: string; scope?: string | null; all?: boolean }

type RuntimeModule = {
	__init(env: {
		KODY: {
			credentialOpen: (args: CredentialOpenArgs, call: unknown) => Promise<CredentialInfo | Array<CredentialInfo>>
			mcpCall?: (name: string, tool: string, args: unknown, call: unknown) => Promise<unknown>
		}
	}): void
	credential: ((key: string) => Promise<CredentialClient>) & {
		named(name: string, options?: { scope?: string }): Promise<CredentialClient>
	}
	credentials(key: string): Promise<Array<CredentialClient>>
}

const runtime = async (): Promise<RuntimeModule> => {
	const url = `data:text/javascript;base64,${Buffer.from(RUNTIME_MODULE_SOURCE).toString('base64')}`
	return (await import(url)) as RuntimeModule
}

const opened = (overrides: Partial<CredentialInfo> = {}): CredentialInfo => ({
	name: 'api',
	scope: 'user',
	kind: 'secret',
	hosts: ['api.example.com'],
	...overrides,
})

describe('runtime credential clients', () => {
	it('uses secret placeholders and overwrites caller Authorization headers', async () => {
		const module = await runtime()
		module.__init({ KODY: { credentialOpen: async () => opened() } })
		const originalFetch = globalThis.fetch
		let request: Request | undefined
		globalThis.fetch = (async (input) => {
			request = input as Request
			return new Response('ok')
		}) as typeof fetch
		try {
			const client = await module.credential('api')
			assert.ok(client.fetch)
			await client.fetch('https://api.example.com/data', { headers: { Authorization: 'Caller value' } })
			assert.equal(request?.headers.get('authorization'), 'Bearer {{secret:api|scope=user}}')
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it('uses the package secret placeholder and OAuth integration placeholder', async () => {
		const module = await runtime()
		const originalFetch = globalThis.fetch
		const seen: Array<string | null> = []
		globalThis.fetch = (async (input) => {
			seen.push((input as Request).headers.get('authorization'))
			return new Response('ok')
		}) as typeof fetch
		try {
			module.__init({
				KODY: {
					credentialOpen: async ({ key }) =>
						key === 'package'
							? opened({ name: 'shared', scope: 'package' })
							: opened({ name: 'github', kind: 'oauth' }),
				},
			})
			const packageClient = await module.credential('package')
			const oauthClient = await module.credential('oauth')
			assert.ok(packageClient.fetch)
			assert.ok(oauthClient.fetch)
			await packageClient.fetch('https://api.example.com/')
			await oauthClient.fetch('https://api.example.com/')
			assert.deepEqual(seen, ['Bearer {{secret:shared|scope=package}}', 'Bearer {{integration-token:github}}'])
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it('opens named credentials with the requested scope', async () => {
		const module = await runtime()
		let request: CredentialOpenArgs | undefined
		module.__init({
			KODY: {
				credentialOpen: async (args) => {
					request = args
					return opened({ name: 'shared', scope: 'package' })
				},
			},
		})
		await module.credential.named('shared', { scope: 'package' })
		assert.deepEqual(request, { name: 'shared', scope: 'package' })
	})

	it('resolves relative URLs against the first exact host and denies off-host absolute URLs', async () => {
		const module = await runtime()
		module.__init({
			KODY: {
				credentialOpen: async () => opened({ hosts: ['*.example.com', 'api.example.com', 'second.example.com'] }),
			},
		})
		const originalFetch = globalThis.fetch
		let url = ''
		globalThis.fetch = (async (input) => {
			url = (input as Request).url
			return new Response('ok')
		}) as typeof fetch
		try {
			const client = await module.credential('api')
			assert.ok(client.fetch)
			await client.fetch('/items')
			assert.equal(url, 'https://api.example.com/items')
			await assert.rejects(client.fetch('https://elsewhere.example.net/'), (error: unknown) => {
				const credentialError = error as { name?: string; code?: string }
				return credentialError.name === 'CredentialError' && credentialError.code === 'credential_denied'
			})
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it('follows cross-host redirects without forwarding Authorization', async () => {
		const module = await runtime()
		module.__init({
			KODY: { credentialOpen: async () => opened({ hosts: ['api.example.com', 'other.example.com'] }) },
		})
		const originalFetch = globalThis.fetch
		const requests: Array<Request> = []
		globalThis.fetch = (async (input) => {
			const request = input as Request
			requests.push(request)
			if (requests.length === 1) {
				return new Response(null, { status: 302, headers: { location: 'https://other.example.com/next' } })
			}
			return new Response('ok')
		}) as typeof fetch
		try {
			const client = await module.credential('api')
			assert.ok(client.fetch)
			const response = await client.fetch('https://api.example.com/start', { headers: { cookie: 'a=b' } })
			assert.equal(requests[0]?.headers.get('authorization'), 'Bearer {{secret:api|scope=user}}')
			assert.equal(requests[1]?.url, 'https://other.example.com/next')
			assert.equal(requests[1]?.headers.has('authorization'), false)
			assert.equal(requests[1]?.headers.has('cookie'), false)
			assert.equal(response.redirected, true)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it('calls MCP tools with the server name, tool, and arguments', async () => {
		const module = await runtime()
		const calls: Array<Array<unknown>> = []
		module.__init({
			KODY: {
				credentialOpen: async () => opened({ name: 'docs', kind: 'mcp' }),
				mcpCall: async (...args) => calls.push(args),
			},
		})
		const client = await module.credential('docs')
		assert.ok(client.callTool)
		await client.callTool('search', { query: 'celld' })
		assert.deepEqual(calls[0]?.slice(0, 3), ['docs', 'search', { query: 'celld' }])
	})

	it('returns every opened credential client for a multiple slot', async () => {
		const module = await runtime()
		module.__init({
			KODY: {
				credentialOpen: async ({ all }) => (all ? [opened(), opened({ name: 'secondary' })] : opened()),
			},
		})
		const clients = await module.credentials('api')
		assert.deepEqual(
			clients.map((client) => client.fetch !== undefined),
			[true, true],
		)
	})

	it('round-trips host credential error codes and metadata', async () => {
		const module = await runtime()
		module.__init({
			KODY: {
				credentialOpen: async ({ key }) => {
					if (key === 'missing') {
						throw new Error(
							'credential_unbound: No credential matches "missing".\n__kody_credential_error_details__:{"createUrl":"https://kody.example/account/secrets"}',
						)
					}
					throw new Error(
						'credential_ambiguous: Choose a credential.\n__kody_credential_error_details__:{"options":[{"name":"api","scope":"user","kind":"secret"}],"retryWith":["credential.named(name, { scope })"]}',
					)
				},
			},
		})
		await assert.rejects(module.credential('api'), (error: unknown) => {
			const credentialError = error as {
				name?: string
				code?: string
				options?: Array<{ name: string }>
				retryWith?: Array<string>
			}
			return (
				credentialError.name === 'CredentialError' &&
				credentialError.code === 'credential_ambiguous' &&
				credentialError.options?.[0]?.name === 'api' &&
				credentialError.retryWith?.length === 1
			)
		})
		await assert.rejects(module.credential('missing'), (error: unknown) => {
			const credentialError = error as { name?: string; code?: string; createUrl?: string }
			return (
				credentialError.name === 'CredentialError' &&
				credentialError.code === 'credential_unbound' &&
				credentialError.createUrl === 'https://kody.example/account/secrets'
			)
		})
	})
})

test('workflows.create dispatches the packageWorkflowCreate host capability', async () => {
	const calls: Array<unknown> = []
	const source = `data:text/javascript;base64,${Buffer.from(RUNTIME_MODULE_SOURCE).toString('base64')}`
	const runtime = (await import(source)) as {
		__init: (host: unknown) => void
		workflows: { create: (input: unknown) => Promise<unknown> }
	}
	runtime.__init({
		KODY: {
			capability: async (...args: Array<unknown>) => {
				calls.push(args)
				return { ok: true }
			},
		},
	})
	assert.deepEqual(await runtime.workflows.create({ code: 'export default 1' }), { ok: true })
	assert.deepEqual(calls, [['packageWorkflowCreate', { code: 'export default 1' }, expectNoContext()]])
})

function expectNoContext() {
	return null
}
