import type { JsonSchema } from '../capabilities/define.ts'
import type { CapabilityDefinition } from '../capabilities/define.ts'
import { searchToolSchema } from '../mcp/tool-schemas.ts'
import { apiOperationOptions, getAvailableApiOperations } from './operations.ts'

const executeSchema: JsonSchema = {
	type: 'object',
	oneOf: [{ required: ['code'] }, { required: ['invoke'] }],
	properties: {
		code: { type: 'string' },
		invoke: { type: 'string', description: 'A kody:@scope/package/export specifier.' },
		params: { type: 'object' },
		responseLimit: { type: 'integer', minimum: 1 },
		idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
		conversationId: { type: 'string' },
		memoryContext: { type: 'string' },
	},
}

type ApiCapability = Pick<CapabilityDefinition, 'name' | 'inputSchema' | 'readOnly'>

function inputSchema(operationId: string, capabilityByName: Map<string, ApiCapability>): JsonSchema {
	if (operationId === 'execute') return executeSchema
	if (operationId === 'search') {
		const properties = Object.fromEntries(
			Object.entries(searchToolSchema.properties).filter(([name]) => name !== 'memoryContext'),
		)
		return { ...searchToolSchema, properties }
	}
	return capabilityByName.get(operationId)?.inputSchema ?? { type: 'object', properties: {} }
}

function pathParameterNames(path: string) {
	return [...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!)
}

export function buildOpenApiDocument(publicUrl: string, registeredCapabilities: readonly ApiCapability[]) {
	const paths: Record<string, Record<string, unknown>> = {}
	const capabilityByName = new Map(registeredCapabilities.map((capability) => [capability.name, capability]))
	const operations = getAvailableApiOperations(registeredCapabilities.map((capability) => capability.name))
	for (const [method, path, operationId] of operations) {
		const schema = inputSchema(operationId, capabilityByName)
		const options = apiOperationOptions[operationId]
		const renames = options?.pathParams ?? {}
		const pathNames = pathParameterNames(path)
		const pathInputNames = new Set(pathNames.map((name) => renames[name] ?? name))
		const properties = schema.properties ?? {}
		const parameters = pathNames.map((name) => ({
			name,
			in: 'path',
			required: true,
			schema: properties[renames[name] ?? name] ?? { type: 'string' },
		}))
		const isQuery = method === 'GET' || method === 'DELETE'
		const operationDocument: Record<string, unknown> = {
			operationId,
			security: [{ BearerAuth: [] }],
			parameters: [
				...parameters,
				...(isQuery
					? Object.entries(properties)
							.filter(([name]) => !pathInputNames.has(name) && !options?.omitInputs?.includes(name))
							.map(([name, property]) => ({
								name,
								in: 'query',
								required: (schema.required ?? []).includes(name),
								schema: property,
								...(isArraySchema(property) ? { style: 'form', explode: true } : {}),
							}))
					: []),
			],
			'x-kody-read-only': operationId === 'search' || capabilityByName.get(operationId)?.readOnly === true,
			responses: {
				'200': {
					description: 'Capability result.',
					content: { 'application/json': { schema: {} } },
				},
				default: { $ref: '#/components/responses/Error' },
			},
		}
		if (!isQuery) {
			const requestProperties = Object.fromEntries(
				Object.entries(properties).filter(([name]) => !pathInputNames.has(name)),
			)
			operationDocument.requestBody = {
				required: true,
				content: {
					'application/json': {
						schema: {
							...schema,
							properties: requestProperties,
							required: (schema.required ?? []).filter((name) => !pathInputNames.has(name)),
						},
					},
				},
			}
		}
		paths[path] ??= {}
		paths[path]![method.toLowerCase()] = operationDocument
	}
	return {
		openapi: '3.1.0',
		info: {
			title: 'Kody API',
			version: '1.0.0',
			description:
				'Authenticate requests with a Bearer token. celld API tokens use the kc_ prefix; OAuth access tokens use the mcpat_ prefix.',
		},
		servers: [{ url: new URL(publicUrl).origin }],
		paths,
		components: {
			schemas: {
				Error: {
					type: 'object',
					properties: {
						error: {
							type: 'object',
							properties: {
								code: { type: 'string' },
								message: { type: 'string' },
								details: {},
							},
							required: ['code', 'message'],
						},
					},
					required: ['error'],
				},
			},
			responses: {
				Error: {
					description: 'Error envelope.',
					content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
				},
			},
			securitySchemes: {
				BearerAuth: { type: 'http', scheme: 'bearer' },
			},
		},
	}
}

function isArraySchema(schema: JsonSchema) {
	return schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))
}
