import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CapabilityContext } from './define.ts'
import { maxComputedImportDepth, packageComputedImport } from './computed-import.ts'

function context(overrides: Partial<CapabilityContext> = {}) {
	return {
		env: {} as CapabilityContext['env'],
		exports: {} as CapabilityContext['exports'],
		user: { id: 'user-1', email: 'owner@example.test' },
		userCell: {} as CapabilityContext['userCell'],
		packageName: '@scope/source',
		runId: 'run-1',
		eventDepth: 0,
		computedImportDepth: 0,
		baseUrl: 'http://localhost',
		fromRuntime: true,
		...overrides,
	} as CapabilityContext
}

describe('packageComputedImport', () => {
	it('rejects specifiers outside the kody:@ package namespace', async () => {
		await assert.rejects(packageComputedImport.handler({ specifier: './module.js' }, context()), (error: unknown) => {
			assert.equal((error as { code?: string }).code, 'invalid_import')
			return true
		})
	})

	it('rejects a nested import at the maximum depth', async () => {
		await assert.rejects(
			packageComputedImport.handler(
				{ specifier: 'kody:@scope/pkg/export' },
				context({ computedImportDepth: maxComputedImportDepth }),
			),
			(error: unknown) => {
				assert.equal((error as { code?: string }).code, 'computed_import_depth_exceeded')
				assert.equal(
					(error as { message?: string }).message,
					`Computed kody:@ import exceeded the maximum nested depth (${maxComputedImportDepth}).`,
				)
				return true
			},
		)
	})
})
