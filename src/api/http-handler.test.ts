import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityDefinition } from '../capabilities/define.ts'
import type { Principal } from '../auth/authenticate.ts'
import type { Env } from '../env.ts'
import { KodyError } from '../lib/errors.ts'
import { handleApiRequest } from './http-handler.ts'

const env = { KODY_PUBLIC_URL: 'https://celld.example' } as Env
const execution = { exports: {} } as ExecutionContext
const principal = {
	user: { id: 'user-1', email: 'user@example.test' },
	userCell: {},
	via: 'api_token',
	clientName: null,
} as unknown as Principal
const capabilities: Array<Pick<CapabilityDefinition, 'name' | 'inputSchema' | 'readOnly'>> = [
	{ name: 'packageList', readOnly: true, inputSchema: { type: 'object', properties: {} } },
]

test('returns the hosted bearer error shape without authentication', async () => {
	const response = await handleApiRequest(new Request('https://celld.example/v1/packages'), env, execution, {
		capabilities,
		authenticate: async () => null,
	})
	assert.equal(response.status, 401)
	assert.deepEqual(await response.json(), {
		error: {
			code: 'unauthorized',
			message: 'Authentication required. Send Authorization: Bearer <Kody API token>.',
		},
	})
})

test('serializes Kody errors without changing their status', async () => {
	const response = await handleApiRequest(new Request('https://celld.example/v1/packages'), env, execution, {
		capabilities,
		authenticate: async () => principal,
		runCapability: async () => {
			throw new KodyError('invalid_input', 'A value was rejected.', {
				status: 422,
				details: { field: 'name' },
			})
		},
	})
	assert.equal(response.status, 422)
	assert.deepEqual(await response.json(), {
		error: { code: 'invalid_input', message: 'A value was rejected.', details: { field: 'name' } },
	})
})

test('does not expose details from unexpected errors', async () => {
	const response = await handleApiRequest(new Request('https://celld.example/v1/packages'), env, execution, {
		capabilities,
		authenticate: async () => principal,
		runCapability: async () => {
			throw new Error('private stack detail')
		},
	})
	assert.equal(response.status, 500)
	assert.deepEqual(await response.json(), {
		error: { code: 'internal_error', message: 'Internal server error.' },
	})
})

test('serves the OpenAPI document with an ETag and returns 304 for a match', async () => {
	const first = await handleApiRequest(new Request('https://celld.example/openapi.json'), env, execution, {
		capabilities,
	})
	assert.equal(first.status, 200)
	assert.equal(first.headers.get('cache-control'), 'public, max-age=300')
	const etag = first.headers.get('etag')
	assert(etag)
	const second = await handleApiRequest(
		new Request('https://celld.example/openapi.json', { headers: { 'if-none-match': etag } }),
		env,
		execution,
		{ capabilities },
	)
	assert.equal(second.status, 304)
	assert.equal(await second.text(), '')
})
