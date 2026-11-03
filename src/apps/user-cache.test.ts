import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { UserRecord } from '../cells/registry-cell.ts'
import { createUserCache } from './user-cache.ts'

const user = (id: string): UserRecord => ({ id, email: `${id}@example.com`, createdAt: '' })

describe('createUserCache', () => {
	it('looks a user up once and reuses the record', async () => {
		const cache = createUserCache(4)
		let reads = 0
		const lookup = async (id: string) => {
			reads++
			return user(id)
		}
		assert.deepEqual(await cache.get('user_a', lookup), user('user_a'))
		assert.deepEqual(await cache.get('user_a', lookup), user('user_a'))
		assert.equal(reads, 1)
	})
	it('does not cache a missing user', async () => {
		const cache = createUserCache(4)
		let reads = 0
		const lookup = async () => {
			reads++
			return null
		}
		assert.equal(await cache.get('user_a', lookup), null)
		assert.equal(await cache.get('user_a', lookup), null)
		assert.equal(reads, 2)
	})
	it('evicts the least recently used user past the limit', async () => {
		const cache = createUserCache(2)
		const reads: Array<string> = []
		const lookup = async (id: string) => {
			reads.push(id)
			return user(id)
		}
		await cache.get('a', lookup)
		await cache.get('b', lookup)
		await cache.get('a', lookup)
		await cache.get('c', lookup)
		await cache.get('a', lookup)
		await cache.get('b', lookup)
		assert.deepEqual(reads, ['a', 'b', 'c', 'b'])
	})
})
