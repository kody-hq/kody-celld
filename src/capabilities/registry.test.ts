import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityContext } from './define.ts'
import { createCapabilityRegistry } from './lookup.ts'
import { secretSet } from './secrets.ts'
import { KodyError } from '../lib/errors.ts'

test('capability aliases resolve to the canonical definition without duplicate listings', async () => {
	const capabilities = [secretSet]
	const registry = createCapabilityRegistry(capabilities)
	const canonical = registry.getCapability('secretSet')
	assert.ok(canonical)
	assert.equal(registry.getCapability('secretSave'), canonical)
	assert.equal(capabilities.filter((capability) => capability.name === 'secretSet').length, 1)
	assert.equal(
		capabilities.some((capability) => capability.name === 'secretSave'),
		false,
	)

	await assert.rejects(
		registry.runCapability('secretSave', {}, {} as CapabilityContext),
		(error: unknown) =>
			error instanceof KodyError && error.code === 'invalid_args' && error.message.includes('secretSave'),
	)
})

test('unknown capability names still fail', async () => {
	const registry = createCapabilityRegistry([secretSet])
	await assert.rejects(
		registry.runCapability('notACapability', {}, {} as CapabilityContext),
		(error: unknown) => error instanceof KodyError && error.code === 'unknown_capability',
	)
})

test('capability name collisions fail during registry creation', () => {
	assert.throws(
		() => createCapabilityRegistry([secretSet, { ...secretSet, name: 'other', aliases: ['secretSet'] }]),
		/Capability name "secretSet" is declared more than once\./,
	)
})
