import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityDefinition } from '../capabilities/define.ts'
import { apiOperationOptions, getAvailableApiOperations } from './operations.ts'
import { registeredRouteCapabilities } from './test-capabilities.ts'
import { buildOpenApiDocument } from './document.ts'

const registeredCapabilities: Array<Pick<CapabilityDefinition, 'name' | 'readOnly' | 'inputSchema'>> = [
	{ name: 'packageList', readOnly: true, inputSchema: { type: 'object', properties: {} } },
	{ name: 'packageGet', readOnly: true, inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
	{ name: 'runGet', readOnly: true, inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
	...registeredRouteCapabilities,
]

test('documents unique operations registered in the capability registry', () => {
	const document = buildOpenApiDocument('https://celld.example/path', registeredCapabilities)
	assert.equal(document.openapi, '3.1.0')
	assert.deepEqual(document.servers, [{ url: 'https://celld.example' }])
	assert('/v1/packages' in document.paths)
	assert('/v1/memories' in document.paths)
	assert('/v1/secrets' in document.paths)
	assert('/v1/webhooks' in document.paths)
	assert('/v1/email/inboxes' in document.paths)
	assert(!('/v1/me' in document.paths))
	assert(!('/v1/mcp-server-instructions' in document.paths))
	assert(!('/v1/credentials' in document.paths))
	assert(!('/v1/storage/{storage_id}/export' in document.paths))
	const execute = document.paths['/v1/execute']?.post as {
		requestBody: { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } }
	}
	assert(!('credentials' in execute.requestBody.content['application/json'].schema.properties))

	const operationIds = Object.values(document.paths).flatMap((path) =>
		Object.values(path)
			.filter((operation): operation is { operationId: string } => typeof operation === 'object' && operation !== null)
			.map((operation) => operation.operationId),
	)
	assert.equal(new Set(operationIds).size, operationIds.length)
	for (const path of Object.values(document.paths)) {
		for (const operation of Object.values(path) as Array<{ responses?: Record<string, unknown> }>) {
			assert(operation.responses?.['200'])
			assert(operation.responses?.default)
		}
	}
})

test('documents hosted path parameter names with celld input schemas', () => {
	const document = buildOpenApiDocument('https://celld.example', registeredCapabilities)
	const runGet = document.paths['/v1/runs/{run_id}']?.get as {
		parameters: Array<{ name: string; in: string; required: boolean; schema: { type?: string } }>
	}
	assert.deepEqual(runGet.parameters, [{ name: 'run_id', in: 'path', required: true, schema: { type: 'string' } }])
})

test('documents registered hosted rows and their renamed path inputs', () => {
	const document = buildOpenApiDocument('https://celld.example', registeredCapabilities)
	const capabilities = new Map(registeredCapabilities.map((capability) => [capability.name, capability] as const))
	const routes = getAvailableApiOperations(capabilities.keys())

	for (const [method, path, operationId] of routes) {
		if (!capabilities.has(operationId)) continue
		const operation = document.paths[path]?.[method.toLowerCase()] as
			{ operationId?: string; parameters?: Array<{ name: string; in: string }> } | undefined
		assert(operation, `missing documented route ${method} ${path}`)
		assert.equal(operation.operationId, operationId)

		const capability = capabilities.get(operationId)!
		const pathParams = [...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!)
		for (const pathParam of pathParams) {
			const inputName = apiOperationOptions[operationId]?.pathParams?.[pathParam] ?? pathParam
			assert(inputName in (capability.inputSchema.properties ?? {}), `${operationId} is missing input ${inputName}`)
			assert(operation.parameters?.some((parameter) => parameter.name === pathParam && parameter.in === 'path'))
		}
	}

	for (const [operationId, options] of Object.entries(apiOperationOptions)) {
		const capability = capabilities.get(operationId)
		if (!capability || !options.pathParams) continue
		for (const inputName of Object.values(options.pathParams)) {
			assert(inputName in (capability.inputSchema.properties ?? {}), `${operationId} is missing input ${inputName}`)
		}
	}
})
