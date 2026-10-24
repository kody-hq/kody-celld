import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { IntegrationUsage } from '../integrations/oauth.ts'
import {
	addSecretPackageGrant,
	allowedPackagesForSecretUsage,
	removeSecretPackageGrant,
	secretApprovalUrl,
	secretUsagePermitsPackage,
	secretUsageFromJson,
} from './usage.ts'

describe('secret package grants', () => {
	it('adds grants, avoids duplicates, and returns to any after removing the last grant', () => {
		const initial = secretUsageFromJson('{"mode":"any"}')
		const first = addSecretPackageGrant(initial, '@example/app')
		assert.deepEqual(first, { mode: 'packages', packages: ['@example/app'] })
		assert.deepEqual(addSecretPackageGrant(first, '@example/app'), first)
		const second = addSecretPackageGrant(first, 'example/other')
		assert.deepEqual(removeSecretPackageGrant(second, '@example/app'), {
			mode: 'packages',
			packages: ['example/other'],
		})
		const lastRemoved = removeSecretPackageGrant(first, '@example/app')
		assert.deepEqual(lastRemoved, { mode: 'any' })
		assert.deepEqual(allowedPackagesForSecretUsage(lastRemoved), [])
	})

	it('keeps ad hoc execute allowed and denies packages outside the grant list', () => {
		const usage: IntegrationUsage = { mode: 'packages', packages: ['example/allowed'] }
		assert.equal(secretUsagePermitsPackage(usage, null), true)
		assert.equal(secretUsagePermitsPackage(usage, 'example/allowed'), true)
		assert.equal(secretUsagePermitsPackage(usage, 'example/other'), false)
		assert.equal(secretUsagePermitsPackage({ mode: 'any' }, 'example/other'), true)
	})

	it('builds an encoded owner approval link', () => {
		assert.equal(
			secretApprovalUrl('https://kody.example/', 'api key', '@example/app'),
			'https://kody.example/account/secrets/approve?name=api+key&package=%40example%2Fapp',
		)
	})
})
