import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderStartDocument } from './start-render.ts'
import { firstPartySecurityHeaders } from './security-headers.ts'

function render(pathname = '/brand-guide', displayName?: string) {
	return renderStartDocument(new Request(`http://localhost${pathname}`), {
		title: 'Brand guide',
		pathname: '/brand-guide',
		data: { page: 'brandGuide' },
		session: displayName
			? {
					displayName,
					email: 'fixture@example.invalid',
					avatarUrl: null,
					isAdmin: true,
				}
			: null,
		headers: { 'referrer-policy': 'no-referrer' },
	})
}

describe('Start document renderer', () => {
	it('renders the hosted brand guide with the celld document and native links', async () => {
		for (const pathname of [
			'/brand-guide',
			'/brand-guide/',
			'/brand-guide?view=assets',
		]) {
			const response = await render(pathname)
			assert.equal(response.status, 200)
			assert.equal(response.headers.get('location'), null)
			assert.equal(
				response.headers.get('content-type'),
				'text/html; charset=utf-8',
			)
			assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
			for (const key of [
				'cache-control',
				'x-frame-options',
				'x-content-type-options',
			]) {
				assert.equal(response.headers.get(key), firstPartySecurityHeaders[key])
			}
			const html = await response.text()
			assert.ok(html.startsWith('<!DOCTYPE html>'))
			assert.equal(html.match(/<!DOCTYPE html>/g)?.length, 1)
			assert.ok(html.includes('<title>Brand guide · Kody</title>'))
			assert.ok(html.includes('data-emotion='))
			assert.ok(html.includes('name="robots" content="noindex"'))
			assert.ok(html.includes('href="/styles.css"'))
			assert.ok(html.includes('src="/page-init.js"'))
			assert.ok(html.includes('/build/start/assets/'))
			assert.ok(!html.includes('/build/client-entry.js'))
			assert.ok(html.includes('href="/signin"'))
			assert.ok(html.includes('href="/community"'))
			assert.ok(html.includes('github.com/kody-hq/kody-celld'))
			const csp = response.headers.get('content-security-policy')!
			const nonce = csp.match(/'nonce-([a-f0-9]{32})'/)?.[1]
			assert.ok(nonce)
			const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
			assert.ok(scripts.length > 1)
			for (const [, attributes] of scripts) {
				if (
					attributes?.includes('src="/page-init.js"') ||
					attributes?.includes('src="/emotion-style-hoist.js"')
				)
					continue
				assert.ok(attributes?.includes(`nonce="${nonce}"`), attributes)
			}
		}
	})
	it('isolates concurrent session and nonce contexts and escapes hostile strings', async () => {
		const names = Array.from(
			{ length: 8 },
			(_, i) => `identity-${i}-<img src=x onerror=alert(1)>`,
		)
		const results = await Promise.all(
			names.map(async (name) => {
				const response = await render('/brand-guide', name)
				return {
					html: await response.text(),
					csp: response.headers.get('content-security-policy')!,
				}
			}),
		)
		assert.equal(new Set(results.map((r) => r.csp)).size, names.length)
		for (const [i, result] of results.entries()) {
			assert.ok(result.html.includes(`identity-${i}-&lt;img`))
			assert.ok(!result.html.includes('<img src=x onerror=alert(1)>'))
			assert.ok(result.html.includes('href="/console"'))
			assert.ok(result.html.includes('href="/account"'))
			for (const j of names.keys()) {
				if (i !== j) assert.ok(!result.html.includes(`identity-${j}-`))
			}
		}
	})
	it('refuses to render a document without its matching request nonce', async () => {
		const { default: server } = await import('#start-server')
		const response = await server.fetch(
			new Request('http://localhost/brand-guide'),
			{
				context: {
					nonce: '',
					document: {
						title: 'Invalid',
						pathname: '/brand-guide',
						data: { page: 'brandGuide' },
						session: null,
						flash: null,
						version: 'test',
					},
				},
			},
		)
		assert.equal(response.status, 500)
		assert.ok(!(await response.text()).includes('<!DOCTYPE html>'))
	})
})
