import assert from 'node:assert/strict'
import test from 'node:test'
import { apiOperationOptions, apiOperations, getAvailableApiOperations, matchApiRoute } from './operations.ts'
import { registeredRouteCapabilities } from './test-capabilities.ts'

test('matches hosted path params and selects a method-matched route', () => {
	const route = matchApiRoute('GET', '/v1/packages/counter')
	assert.equal(route.kind, 'match')
	if (route.kind === 'match') {
		assert.equal(route.route.operation[2], 'packageGet')
		assert.deepEqual(route.route.pathParams, { package_id: 'counter' })
	}
	const staticRoute = matchApiRoute('GET', '/v1/packages/check')
	assert.equal(staticRoute.kind, 'match')
	if (staticRoute.kind === 'match') assert.equal(staticRoute.route.operation[2], 'packageGet')
})

test('distinguishes unknown paths and methods', () => {
	assert.deepEqual(matchApiRoute('GET', '/v1/unknown'), { kind: 'not_found' })
	assert.deepEqual(matchApiRoute('POST', '/v1/packages'), {
		kind: 'match',
		route: {
			operation: ['POST', '/v1/packages', 'packageSave'],
			pathParams: {},
		},
	})
	assert.deepEqual(matchApiRoute('DELETE', '/v1/packages'), {
		kind: 'method_not_allowed',
		allow: ['GET', 'POST'],
	})
})

test('registers native token routes in addition to capabilities', () => {
	const operations = getAvailableApiOperations([])
	assert.deepEqual(
		operations.filter(([, path]) => path.startsWith('/v1/tokens')),
		[
			['POST', '/v1/tokens/device', 'cliLoginDeviceToken'],
			['GET', '/v1/tokens', 'tokenList'],
			['POST', '/v1/tokens', 'tokenCreate'],
			['GET', '/v1/tokens/current', 'tokenGetCurrent'],
			['POST', '/v1/tokens/current/rotate', 'tokenRotateCurrent'],
			['DELETE', '/v1/tokens/current', 'tokenRevokeCurrent'],
			['GET', '/v1/tokens/{token_id}', 'tokenGet'],
			['POST', '/v1/tokens/{token_id}/rotate', 'tokenRotate'],
			['DELETE', '/v1/tokens/{token_id}', 'tokenRevoke'],
		],
	)
})

test('static current-token routes take precedence over token-id routes', () => {
	const getCurrent = matchApiRoute('GET', '/v1/tokens/current')
	assert.equal(getCurrent.kind, 'match')
	if (getCurrent.kind === 'match') assert.equal(getCurrent.route.operation[2], 'tokenGetCurrent')
	const rotateCurrent = matchApiRoute('POST', '/v1/tokens/current/rotate')
	assert.equal(rotateCurrent.kind, 'match')
	if (rotateCurrent.kind === 'match') assert.equal(rotateCurrent.route.operation[2], 'tokenRotateCurrent')
})

test('serves hosted rows only when their capability is registered', () => {
	const capabilities = new Map<string, (typeof registeredRouteCapabilities)[number]>(
		registeredRouteCapabilities.map((capability) => [capability.name, capability] as const),
	)
	const available = getAvailableApiOperations(capabilities.keys())
	const availableIds = new Set(available.map((operation) => operation[2]))
	const prefixes = [
		'/v1/memories',
		'/v1/mcp-server-instructions',
		'/v1/secrets',
		'/v1/credentials',
		'/v1/secret-providers',
		'/v1/webhooks',
		'/v1/email',
		'/v1/integrations',
		'/v1/oauth-apps',
		'/v1/platform-apps',
		'/v1/mcp-servers',
		'/v1/community',
		'/v1/storage',
	]
	const hostedRows = apiOperations.filter(([, path]) => prefixes.some((prefix) => path.startsWith(prefix)))

	for (const [, , operationId] of hostedRows) {
		assert.equal(availableIds.has(operationId), capabilities.has(operationId), operationId)
	}
	const conditionalOperations = new Set(['credentialMappingPropose', 'credentialTriggerPickSet'])
	assert(!hostedRows.some(([, , operationId]) => conditionalOperations.has(operationId)))
	assert(!hostedRows.some(([, path]) => path.includes('/personal-credential-grants')))
	const excludedPathParts = ['/v1/access', '/v1/orgs', '/v1/teams', '/v1/invites', '/collaborators']
	assert(!apiOperations.some(([, path]) => excludedPathParts.some((part) => path.includes(part))))
})

test('every new path rename targets a property in the registered capability schema', () => {
	const capabilities = new Map<string, (typeof registeredRouteCapabilities)[number]>(
		registeredRouteCapabilities.map((capability) => [capability.name, capability] as const),
	)
	const prefixes = [
		'/v1/memories',
		'/v1/secrets',
		'/v1/secret-providers',
		'/v1/webhooks',
		'/v1/email',
		'/v1/integrations',
		'/v1/oauth-apps',
		'/v1/platform-apps',
		'/v1/mcp-servers',
		'/v1/community',
		'/v1/storage',
	]

	for (const [, path, operationId] of apiOperations) {
		if (!prefixes.some((prefix) => path.startsWith(prefix))) continue
		const capability = capabilities.get(operationId)
		if (!capability) continue
		const renamedParams = apiOperationOptions[operationId]?.pathParams ?? {}
		for (const inputName of Object.values(renamedParams)) {
			assert(inputName in (capability.inputSchema.properties ?? {}), `${operationId} is missing input ${inputName}`)
		}
	}
})
