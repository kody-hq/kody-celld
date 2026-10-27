import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageHasAccountRail } from './loader-data.ts'

test('pageHasAccountRail is true for shell pages with the side rail', () => {
	assert.equal(pageHasAccountRail('accountJobs'), true)
	assert.equal(pageHasAccountRail('adminUsers'), true)
})

test('pageHasAccountRail is false for rail-less package browse pages', () => {
	assert.equal(pageHasAccountRail('accountPackagePreviewFiles'), false)
	assert.equal(pageHasAccountRail('accountPackageFiles'), false)
	assert.equal(pageHasAccountRail('accountPackageDetail'), false)
})
