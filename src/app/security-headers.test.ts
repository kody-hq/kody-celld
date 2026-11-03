import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	contentSecurityPolicyWithFormAction,
	contentSecurityPolicyWithNonce,
	firstPartySecurityHeaders,
	pageResponseHeaders,
} from './security-headers.ts'

function directive(csp: string, name: string) {
	return csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? ''
}

describe('contentSecurityPolicyWithNonce', () => {
	it('authorizes only this document nonce without widening other directives', () => {
		const nonce = '0123456789abcdef0123456789abcdef'
		const base = firstPartySecurityHeaders['content-security-policy']!
		const policy = contentSecurityPolicyWithNonce(nonce)
		assert.equal(
			directive(policy, 'script-src'),
			`script-src 'self' 'nonce-${nonce}'`,
		)
		assert.deepEqual(
			policy.split('; ').filter((d) => !d.startsWith('script-src ')),
			base.split('; ').filter((d) => !d.startsWith('script-src ')),
		)
		assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"))
	})
	it('rejects empty, malformed, and directive-injection nonces', () => {
		for (const value of [
			'',
			'a',
			'A'.repeat(32),
			'a'.repeat(33),
			"'; script-src *",
		]) {
			assert.throws(
				() => contentSecurityPolicyWithNonce(value),
				/Invalid document nonce/,
			)
		}
	})
	it('preserves a page-specific form-action policy while adding the document nonce', () => {
		const custom = contentSecurityPolicyWithFormAction(['alice:'])
		const nonce = '0123456789abcdef0123456789abcdef'
		const result = contentSecurityPolicyWithNonce(nonce, custom)
		assert.equal(
			directive(result, 'form-action'),
			directive(custom, 'form-action'),
		)
		assert.equal(
			directive(result, 'script-src'),
			`script-src 'self' 'nonce-${nonce}'`,
		)
		assert.equal(result.split('; ').length, custom.split('; ').length)
	})
})

describe('contentSecurityPolicyWithFormAction', () => {
	it('adds only the given origins to form-action and leaves every other directive as is', () => {
		const base = firstPartySecurityHeaders['content-security-policy']!
		const widened = contentSecurityPolicyWithFormAction([
			'http://172.30.0.85:8123',
		])
		assert.equal(
			directive(widened, 'form-action'),
			"form-action 'self' https: http://localhost:* http://127.0.0.1:* http://172.30.0.85:8123",
		)
		assert.deepEqual(
			widened.split('; ').filter((d) => !d.startsWith('form-action ')),
			base.split('; ').filter((d) => !d.startsWith('form-action ')),
		)
		assert.equal(contentSecurityPolicyWithFormAction([]), base)
	})

	it('accepts a scheme source for a private-use redirect scheme', () => {
		assert.equal(
			directive(contentSecurityPolicyWithFormAction(['alice:']), 'form-action'),
			"form-action 'self' https: http://localhost:* http://127.0.0.1:* alice:",
		)
	})

	it('refuses anything that is not a bare http(s) origin', () => {
		for (const bad of [
			"'unsafe-inline'",
			'http://a.example/path',
			'javascript:alert(1)',
			'http://a.example; script-src *',
			'javascript:',
			'data:',
		]) {
			assert.throws(() => contentSecurityPolicyWithFormAction([bad]))
		}
	})
})

describe('pageResponseHeaders', () => {
	it('replaces the first-party CSP with a page override instead of sending two', () => {
		const widened = contentSecurityPolicyWithFormAction([
			'http://172.30.0.85:8123',
		])
		const headers = pageResponseHeaders({
			'Content-Security-Policy': widened,
			'referrer-policy': 'no-referrer',
		})
		assert.equal(headers['content-security-policy'], widened)
		assert.equal(headers['referrer-policy'], 'no-referrer')
		assert.equal(
			headers['x-frame-options'],
			firstPartySecurityHeaders['x-frame-options'],
		)
		const response = new Response(null, { headers })
		assert.equal(response.headers.get('content-security-policy'), widened)
		assert.equal(
			[...response.headers.keys()].filter(
				(k) => k === 'content-security-policy',
			).length,
			1,
		)
	})
})
