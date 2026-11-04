import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderStartDocument } from './start-render.ts'
import {
	contentSecurityPolicyWithFormAction,
	firstPartySecurityHeaders,
} from './security-headers.ts'
import { getDocumentTimestampLocale } from '../../start/document-locale.ts'
import type { AppLoaderData } from '#universal/loader-data.ts'

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
	it('renders console login and read-only documents with native forms and the correct shell', async () => {
		const cases: Array<{
			path: string
			data: AppLoaderData
			text: string
			status?: number
		}> = [
			{ path: '/console', data: { page: 'adminLogin' }, text: 'name="token"' },
			{
				path: '/console/signin',
				data: { page: 'adminLogin' },
				text: 'name="token"',
				status: 401,
			},
			{
				path: '/console/audit',
				data: {
					page: 'adminAudit',
					csrf: 'fixture-csrf',
					entries: [
						{
							id: 'fixture-audit',
							at: '2026-01-01T00:00:00.000Z',
							actor: 'admin',
							action: 'console.signin',
							target: null,
							details: null,
						},
					],
				},
				text: 'console.signin',
			},
			{
				path: '/console/config',
				data: {
					page: 'adminConfig',
					csrf: 'fixture-csrf',
					version: 'fixture',
					publicUrl: 'http://localhost',
					sections: [{ name: 'email', json: '{"adapter":"noop"}' }],
				},
				text: 'Adapter settings',
			},
		]
		for (const { path, data, text, status = 200 } of cases) {
			const response = await renderStartDocument(
				new Request('http://localhost' + path),
				{ title: 'Console', pathname: path, data, status },
			)
			assert.equal(response.status, status, path)
			const html = await response.text()
			assert.ok(html.includes(text), path)
			assert.equal(
				html.includes('class="site-header'),
				data.page !== 'adminLogin',
				path,
			)
			assert.ok(html.includes('<form method="post"'), path)
			assert.ok(!html.includes('/build/client-entry.js'), path)
			if (data.page === 'adminLogin') {
				const input = html.match(/<input\b[^>]*\bname="token"[^>]*>/)?.[0]
				assert.ok(input, path)
				assert.ok(input.includes('type="password"'), path)
				assert.ok(!/\svalue=/.test(input), path)
			} else assert.ok(html.includes('name="csrf"'), path)
		}
	})

	it('renders native auth and connect forms without site header or legacy scripts', async () => {
		const cases: Array<{ path: string; data: AppLoaderData; text: string }> = [
			{
				path: '/signin',
				data: {
					page: 'login',
					next: '/account',
					email: 'fixture@example.invalid',
					magicLinks: true,
				},
				text: 'name="intent"',
			},
			{
				path: '/setup',
				data: { page: 'setup', passwordMinLength: 12 },
				text: 'name="adminToken"',
			},
			{
				path: '/signin/link/expired',
				data: { page: 'signinLinkExpired' },
				text: 'Link expired',
			},
			{
				path: '/oauth/authorize',
				data: {
					page: 'oauthAuthorizeError',
					error: 'invalid_request',
					description: 'Invalid client',
				},
				text: 'Cannot authorize this client',
			},
			{
				path: '/connect/oauth/fixture-user/fixture-connect',
				data: {
					page: 'connectOauth',
					name: 'fixture',
					provider: 'Fixture provider',
					email: 'fixture@example.invalid',
					hosts: ['api.example.invalid'],
					scopes: ['read'],
					description: 'Local fixture',
					ticket: 'fixture-ticket',
					expiresAt: '2026-01-01T00:00:00.000Z',
				},
				text: 'name="ticket"',
			},
			{
				path: '/connect/oauth/callback',
				data: {
					page: 'connectOauthDone',
					name: 'fixture',
					provider: 'Fixture provider',
					email: 'fixture@example.invalid',
				},
				text: 'Connected fixture',
			},
			{
				path: '/connect/oauth/callback',
				data: {
					page: 'connectOauthError',
					error: 'invalid_request',
					message: 'Invalid provider',
				},
				text: 'Invalid provider',
			},
			{
				path: '/connect/secret-set',
				data: {
					page: 'connectSecretSet',
					csrf: 'fixture-csrf',
					name: 'fixture',
					description: null,
					scope: 'user',
					packageId: null,
					hosts: [],
					unsupportedNote: null,
					error: null,
					saved: false,
					canSubmit: true,
				},
				text: 'type="password"',
			},
		]
		for (const { path, data, text } of cases) {
			const response = await renderStartDocument(
				new Request(`http://localhost${path}`),
				{ title: 'Auth', pathname: path, data },
			)
			assert.equal(response.status, 200, path)
			const html = await response.text()
			assert.ok(html.startsWith('<!DOCTYPE html>'), path)
			assert.ok(html.includes(text), path)
			assert.ok(!html.includes('<header'), path)
			assert.ok(!html.includes('/build/client-entry.js'), path)
			if (data.page === 'connectOauth') {
				assert.ok(html.includes('<form method="post"'), path)
				assert.ok(html.includes('type="hidden" name="ticket"'), path)
			}
			if (data.page === 'connectSecretSet') {
				assert.ok(html.includes('name="csrf"'), path)
				const input = html.match(/<input\b[^>]*\bname="value"[^>]*>/)?.[0]
				assert.ok(input, path)
				assert.ok(!/\svalue=/.test(input), path)
			}
		}
	})
	it('preserves OAuth consent form-action and request nonce together', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/oauth/authorize'),
			{
				title: 'Connect client',
				pathname: '/oauth/authorize',
				data: {
					page: 'oauthAuthorize',
					clientName: 'fixture',
					clientUri: null,
					redirectHost: 'alice:',
					action: '/oauth/authorize',
					csrf: 'fixture-csrf',
					q: 'fixture-query',
					sig: 'fixture-signature',
				},
				headers: {
					'content-security-policy': contentSecurityPolicyWithFormAction([
						'alice:',
					]),
				},
			},
		)
		assert.equal(response.status, 200)
		const policy = response.headers.get('content-security-policy')!
		assert.ok(
			policy.includes(
				"form-action 'self' https: http://localhost:* http://127.0.0.1:* alice:",
			),
		)
		const nonce = policy.match(/'nonce-([a-f0-9]{32})'/)?.[1]
		assert.ok(nonce)
		const html = await response.text()
		assert.ok(html.includes('name="csrf"'))
		assert.ok(html.includes('name="sig"'))
		assert.ok(html.includes('name="decision"'))
		assert.ok(html.includes(`nonce="${nonce}"`))
		assert.ok(!html.includes('<header'))
	})
	it('lets a long unbroken OAuth client name wrap in the consent title (#159)', async () => {
		const clientName = 'A'.repeat(120)
		const response = await renderStartDocument(
			new Request('http://localhost/oauth/authorize'),
			{
				title: 'Connect client',
				pathname: '/oauth/authorize',
				data: {
					page: 'oauthAuthorize',
					clientName,
					clientUri: null,
					redirectHost: 'alice:',
					action: '/oauth/authorize',
					csrf: 'fixture-csrf',
					q: 'fixture-query',
					sig: 'fixture-signature',
				},
				headers: {},
			},
		)
		const html = await response.text()
		const heading = html.indexOf(`Connect ${clientName}</h1>`)
		assert.ok(heading > 0)
		const wrapper = [
			...html.slice(0, heading).matchAll(/<div class="(css-[\w-]+)">/g),
		].at(-1)?.[1]
		assert.ok(wrapper, 'title wrapper div not found')
		const rule = html.match(new RegExp(`\\.${wrapper}\\{([^}]*)\\}`))?.[1] ?? ''
		assert.ok(
			rule.includes('overflow-wrap:anywhere'),
			`title wrapper must wrap long words: ${rule}`,
		)
	})

	it('clips decorative bleed at <main> so pages never widen the viewport (#156)', async () => {
		const html = await (await render()).text()
		const main = html.match(/<main id="main" class="(css-[\w-]+)"/)?.[1]
		assert.ok(main, 'main element not found')
		const rule = html.match(new RegExp(`\\.${main}\\{([^}]*)\\}`))?.[1] ?? ''
		assert.ok(
			rule.includes('overflow-x:clip'),
			`main must clip horizontal overflow: ${rule}`,
		)
	})

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
						timestampLocale: getDocumentTimestampLocale(),
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
