import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	accountNavItems,
	isAccountNavItemActive,
} from './account-navigation.ts'

describe('shared account navigation', () => {
	it('has one destination per section and keeps nested pages in their own section', () => {
		assert.equal(
			new Set(accountNavItems.map((item) => item.href)).size,
			accountNavItems.length,
		)
		assert.ok(isAccountNavItemActive('/account', '/account'))
		assert.ok(!isAccountNavItemActive('/account', '/account/sessions'))
		assert.ok(
			isAccountNavItemActive(
				'/account/packages',
				'/account/packages/example/files/readme.md',
			),
		)
		assert.ok(
			!isAccountNavItemActive('/account/packages', '/account/packages-other'),
		)
		assert.ok(!isAccountNavItemActive('/account/sessions', '/console'))
	})
})
