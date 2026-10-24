import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SecretMetadata, UserCell } from '../cells/user-cell.ts'
import { KodyError } from '../lib/errors.ts'
import { approveSecretPackage, secretPackageApprovalDetails } from './secret-package-approval.ts'

const secret: SecretMetadata = {
	name: 'api-key',
	scope: 'user',
	packageName: null,
	description: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	allowedPackages: [],
}

function cell(overrides: Record<string, unknown> = {}) {
	return {
		secretList: async () => [secret],
		packageGet: async (name: string) => ({ name }),
		secretUsageGrant: async (input: { name: string; packageName: string }) => ({
			...secret,
			allowedPackages: [input.packageName],
		}),
		...overrides,
	} as unknown as Pick<UserCell, 'packageGet' | 'secretList' | 'secretUsageGrant'>
}

describe('secret package approval', () => {
	it('grants only a saved user secret to an installed package', async () => {
		let granted: { name: string; packageName: string } | undefined
		const userCell = cell({
			secretUsageGrant: async (input: { name: string; packageName: string }) => {
				granted = input
				return { ...secret, allowedPackages: [input.packageName] }
			},
		})
		const result = await approveSecretPackage(userCell, { name: 'api-key', packageName: '@example/app' })
		assert.deepEqual(granted, { name: 'api-key', packageName: '@example/app' })
		assert.deepEqual(result.allowedPackages, ['@example/app'])
	})

	it('rejects missing secrets, packages, and package-scope secrets', async () => {
		await assert.rejects(
			secretPackageApprovalDetails(cell({ secretList: async () => [] }), {
				name: 'missing',
				packageName: '@example/app',
			}),
			(error: unknown) => error instanceof KodyError && error.code === 'secret_not_found',
		)
		await assert.rejects(
			secretPackageApprovalDetails(cell({ packageGet: async () => null }), {
				name: 'api-key',
				packageName: '@example/app',
			}),
			(error: unknown) => error instanceof KodyError && error.code === 'package_not_found',
		)
		await assert.rejects(
			secretPackageApprovalDetails(
				cell({
					secretList: async () => [{ ...secret, scope: 'package', packageName: '@example/app' }],
				}),
				{ name: 'api-key', packageName: '@example/app' },
			),
			(error: unknown) => error instanceof KodyError && error.code === 'invalid_secret_scope',
		)
	})
})
