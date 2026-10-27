import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityContext } from './define.ts'
import { createCapabilityRegistry } from './lookup.ts'
import { metaGetCurrentUser } from './system.ts'

test('metaGetCurrentUser returns the hosted identity shape', async () => {
	const ctx = {
		user: { id: 'user-1', email: 'A+User.Name@example.com' },
	} as CapabilityContext
	const registry = createCapabilityRegistry([metaGetCurrentUser])
	const result = await registry.runCapability('metaGetCurrentUser', {}, ctx)
	assert.deepEqual(result, {
		user_id: 'user-1',
		username: 'a-user-name',
		email: 'A+User.Name@example.com',
		display_name: 'A+User.Name',
		org: { slug: 'a-user-name' },
	})
})
