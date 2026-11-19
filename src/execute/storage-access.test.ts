import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runMayOpenPackageStorage } from './storage-access.ts'

test('a run opens storage only for its own package and packages in its graph', () => {
	const run = { packageName: '@me/app', graphPackages: ['@me/app', '@me/lib'] }
	assert.equal(runMayOpenPackageStorage(run, '@me/app'), true)
	assert.equal(runMayOpenPackageStorage(run, '@me/lib'), true)
	assert.equal(runMayOpenPackageStorage(run, '@me/other'), false)
	assert.equal(runMayOpenPackageStorage({ packageName: null, graphPackages: [] }, '@me/app'), false)
	assert.equal(runMayOpenPackageStorage({ packageName: '@me/app' }, '@me/lib'), false)
})
