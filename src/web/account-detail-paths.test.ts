import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routes } from '#universal/routes.ts'
import { matchAccountDetailPath } from './account-detail-paths.ts'

describe('matchAccountDetailPath', () => {
	it('round-trips package names through the typed detail route', () => {
		const href = routes.accountPackageDetail.href({ name: '@oz/ops-jobs' })
		assert.deepEqual(matchAccountDetailPath(new URL(href, 'http://localhost')), {
			kind: 'package',
			name: '@oz/ops-jobs',
		})
	})

	it('round-trips job ids containing encoded delimiters', () => {
		for (const jobId of ['@scope/pkg#job', '@scope/pkg/job']) {
			const href = routes.accountJobDetail.href({ jobId })
			assert.deepEqual(matchAccountDetailPath(new URL(href, 'http://localhost')), { kind: 'job', jobId })
		}
	})

	it('matches nested files and a files page without a selected path', () => {
		const nestedHref = routes.accountPackageFiles.href({
			name: '@oz/ops-jobs',
			relativePath: 'src/lib/a.js',
		})
		assert.deepEqual(matchAccountDetailPath(new URL(nestedHref, 'http://localhost')), {
			kind: 'packageFiles',
			name: '@oz/ops-jobs',
			relativePath: 'src/lib/a.js',
		})

		const filesHref = routes.accountPackageFiles.href({ name: '@oz/ops-jobs' })
		assert.deepEqual(matchAccountDetailPath(new URL(filesHref, 'http://localhost')), {
			kind: 'packageFiles',
			name: '@oz/ops-jobs',
			relativePath: null,
		})
	})

	it('keeps preview URLs apart from a saved package named preview', () => {
		const savedHref = routes.accountPackageFiles.href({ name: 'preview', relativePath: 'files/x.js' })
		assert.deepEqual(matchAccountDetailPath(new URL(savedHref, 'http://localhost')), {
			kind: 'packageFiles',
			name: 'preview',
			relativePath: 'files/x.js',
		})
		const previewHref = routes.accountPackagePreviewFiles.href({ source: 'WyJ4Il0', relativePath: 'a.js' })
		assert.deepEqual(matchAccountDetailPath(new URL(previewHref, 'http://localhost')), {
			kind: 'packagePreviewFiles',
			source: 'WyJ4Il0',
			relativePath: 'a.js',
		})
	})

	it('hands file paths over decoded, once', () => {
		const href = routes.accountPackageFiles.href({ name: '@oz/ops-jobs', relativePath: 'docs/100%.txt' })
		assert.deepEqual(matchAccountDetailPath(new URL(href, 'http://localhost')), {
			kind: 'packageFiles',
			name: '@oz/ops-jobs',
			relativePath: 'docs/100%.txt',
		})
	})

	it('does not match package or job list paths', () => {
		assert.equal(matchAccountDetailPath(new URL('/account/packages', 'http://localhost')), null)
		assert.equal(matchAccountDetailPath(new URL('/account/jobs', 'http://localhost')), null)
	})

	it('treats malformed percent-encoding as no match', () => {
		assert.doesNotThrow(() => matchAccountDetailPath(new URL('/account/packages/%E0%A4%A', 'http://localhost')))
		assert.equal(matchAccountDetailPath(new URL('/account/packages/%E0%A4%A', 'http://localhost')), null)
	})

	it('matches literal browser paths without depending on a URL builder', () => {
		const cases: Array<[string, ReturnType<typeof matchAccountDetailPath>]> = [
			['/account/packages/%40example%2Fpkg?tab=files', { kind: 'package', name: '@example/pkg' }],
			['/account/jobs/pkg%23tick', { kind: 'job', jobId: 'pkg#tick' }],
			['/account/packages/p/files', { kind: 'packageFiles', name: 'p', relativePath: null }],
			['/account/packages/p/files/', { kind: 'packageFiles', name: 'p', relativePath: '' }],
			[
				'/account/packages/p/files/docs/100%2525.txt',
				{ kind: 'packageFiles', name: 'p', relativePath: 'docs/100%25.txt' },
			],
			[
				'/account/package-preview/a%2Fb/files/x%2Fy',
				{ kind: 'packagePreviewFiles', source: 'a/b', relativePath: 'x/y' },
			],
			['/account/packages/p/files//x/', { kind: 'packageFiles', name: 'p', relativePath: '/x/' }],
			['/account/packages/p/', null],
			['/account/jobs/p/x', null],
			['/ACCOUNT/packages/p', null],
			['/account/packages/p/files/%E0%A4%A', null],
			['/account/package-preview/%E0%A4%A/files/x', null],
			['/account/jobs/%E0%A4%A', null],
		]
		for (const [path, expected] of cases) {
			assert.deepEqual(matchAccountDetailPath(new URL(path, 'http://localhost')), expected, path)
		}
	})
})
