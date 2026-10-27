import assert from 'node:assert/strict'
import test from 'node:test'
import { apiOperations, getAvailableApiOperations, matchApiRoute } from './operations.ts'

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

test('keeps future rows but serves only registered capabilities and native routes', () => {
	const available = getAvailableApiOperations(['packageList', 'packageGet'])
	assert(available.some((operation) => operation[2] === 'packageList'))
	assert(available.some((operation) => operation[2] === 'search'))
	assert(available.some((operation) => operation[2] === 'execute'))
	assert(
		!apiOperations.some((operation) =>
			['/v1/memories', '/v1/secrets', '/v1/credentials', '/v1/secret-providers'].some((prefix) =>
				operation[1].startsWith(prefix),
			),
		),
	)
	assert(apiOperations.some((operation) => operation[2] === 'metaGetCurrentUser'))
})
