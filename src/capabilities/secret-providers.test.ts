import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Env } from '../env.ts'
import { KodyError } from '../lib/errors.ts'
import type { CapabilityContext } from './define.ts'
import { secretProviderBind, secretProviderLock, secretProviderUnbind } from './secret-providers.ts'

function setup(locked: boolean) {
	const binding = { providerId: 'vault', packageName: '@me/vault', doorSecretName: 'door', config: {}, locked }
	const writes: Array<string> = []
	const userCell = {
		secretProviderGet: async () => binding,
		secretProviderSetLocked: async (input: { locked: boolean }) => {
			writes.push(`lock:${input.locked}`)
			return { ...binding, locked: input.locked }
		},
		secretProviderBind: async (input: { locked?: boolean }) => {
			writes.push(`bind:${input.locked}`)
			return { ...binding, locked: input.locked ?? binding.locked }
		},
		secretProviderUnbind: async () => {
			writes.push('unbind')
			return { deleted: true }
		},
	}
	const env = { REGISTRY: { getByName: () => ({ auditAppend: async () => {} }) } } as unknown as Env
	const context = (fromRuntime: boolean) =>
		({ env, user: { id: 'user_1' }, userCell, packageName: null, fromRuntime }) as unknown as CapabilityContext
	return { writes, runtime: context(true), session: context(false) }
}

const bindArgs = { providerId: 'vault', packageName: '@me/vault', doorSecretName: 'door' }

async function assertLocked(promise: Promise<unknown>) {
	await assert.rejects(promise, (error: unknown) => {
		assert(error instanceof KodyError)
		assert.equal(error.code, 'secret_provider_locked')
		return true
	})
}

describe('secret provider lock from runtime code', () => {
	it('ad hoc execute cannot unlock a locked binding, directly or by unbinding it', async () => {
		const { writes, runtime } = setup(true)
		await assertLocked(secretProviderLock.handler({ providerId: 'vault', locked: false }, runtime))
		await assertLocked(secretProviderBind.handler({ ...bindArgs, locked: false }, runtime))
		await assertLocked(secretProviderUnbind.handler({ providerId: 'vault' }, runtime))
		assert.deepEqual(writes, [])
	})

	it('ad hoc execute may lock and re-bind without loosening', async () => {
		const { writes, runtime } = setup(true)
		await secretProviderLock.handler({ providerId: 'vault', locked: true }, runtime)
		await secretProviderBind.handler(bindArgs, runtime)
		assert.deepEqual(writes, ['lock:true', 'bind:undefined'])
	})

	it('an unlocked binding and the REST API are unaffected', async () => {
		const unlocked = setup(false)
		await secretProviderUnbind.handler({ providerId: 'vault' }, unlocked.runtime)
		const locked = setup(true)
		await secretProviderLock.handler({ providerId: 'vault', locked: false }, locked.session)
		assert.deepEqual([...unlocked.writes, ...locked.writes], ['unbind', 'lock:false'])
	})
})
