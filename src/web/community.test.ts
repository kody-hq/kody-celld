import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Env } from '../env.ts'
import { handleCommunity } from './community.ts'
import { routes } from '#universal/routes.ts'

function packageFixture(name = '@fixture/community') {
	return {
		name,
		version: '1.0.0',
		description: '<script>untrusted description</script>',
		publisher: 'Fixture publisher',
		installs: 2,
		updatedAt: '2025-01-02T12:00:00.000Z',
		publishedAt: '2025-01-01T12:00:00.000Z',
		fileCount: 1,
		keywords: ['fixture'],
		manifest: {
			exports: { '.': 'index.ts', helper: 'index.ts' },
			jobs: { tick: { entry: 'helper', schedule: { cron: '* * * * *' } } },
		},
		files: { 'index.ts': 'export default () => 1' },
		readme: '<img src=x onerror=alert(1)>',
		agents: '<script>untrusted instructions</script>',
		privateNote: 'private-projection-sentinel',
	}
}

function fixture(options: { empty?: boolean; missing?: boolean; multiple?: boolean } = {}) {
	const calls: Array<unknown> = []
	const env = {
		KODY_PUBLIC_URL: 'http://localhost',
		REGISTRY: {
			getByName(cellName: string) {
				assert.equal(cellName, 'registry')
				return {
					async communitySearch(query: unknown) {
						calls.push(query)
						return options.empty
							? []
							: options.multiple
								? [packageFixture(), packageFixture('@fixture/another')]
								: [packageFixture()]
					},
					async communityStats() {
						return { packages: options.multiple ? 2 : 1, publishers: 1, installs: options.multiple ? 4 : 2 }
					},
					async communityGet(name: string) {
						calls.push(name)
						return options.missing ? null : packageFixture(name)
					},
				}
			},
		},
	} as unknown as Env
	return { env, calls }
}

function request(path: string, env: Env, method = 'GET') {
	const url = new URL(path, 'http://localhost')
	return handleCommunity(new Request(url, { method }), env, url)
}

function assertDocument(response: Response, html: string) {
	assert.match(html, /^<!DOCTYPE html>/)
	assert.equal(html.match(/<!DOCTYPE html>/g)?.length, 1)
	assert.match(html, /data-emotion=/)
	assert.match(html, /\/build\/start\/assets\//)
	assert.ok(!html.includes('/build/client-entry.js'))
	assert.match(response.headers.get('content-security-policy') ?? '', /'nonce-[a-f0-9]{32}'/)
	assert.equal(response.headers.get('cache-control'), 'no-store')
	assert.equal(response.headers.get('x-frame-options'), 'DENY')
	assert.equal(response.headers.get('location'), null)
}

describe('Start community documents', () => {
	it('preserves the native GET search, encoded detail links and public projection', async () => {
		for (const path of ['/community', '/community/', '/community?q=%20fixture%20']) {
			const { env, calls } = fixture()
			const response = await request(path, env)
			const html = await response.text()
			assert.equal(response.status, 200)
			assertDocument(response, html)
			assert.deepEqual(calls, [{ query: path.includes('?') ? 'fixture' : '', limit: 50 }])
			assert.match(html, /<form[^>]*method="get"[^>]*action="\/community"/)
			assert.match(html, /name="q"[^>]*type="search"/)
			assert.ok(html.includes(`href="${routes.communityDetail.href({ name: '@fixture/community' })}"`))
			assert.ok(!html.includes('private-projection-sentinel'))
			assert.ok(!html.includes('<script>untrusted description</script>'))
			assert.ok(html.includes('&lt;script&gt;untrusted description&lt;/script&gt;'))
		}
	})
	it('distinguishes an empty catalog from empty search results', async () => {
		for (const [path, copy] of [
			['/community', 'Nothing published yet.'],
			['/community?q=absent', 'No packages match.'],
		]) {
			const response = await request(path!, fixture({ empty: true }).env)
			assert.equal(response.status, 200)
			assert.ok((await response.text()).includes(copy!))
		}
	})
	it('keeps column groups parser-stable in populated catalog, exports and jobs tables', async () => {
		for (const [path, columnCounts] of [
			['/community', [5]],
			['/community/%40fixture%2Fcommunity', [2, 3]],
		] as const) {
			const response = await request(path, fixture({ multiple: true }).env)
			assert.equal(response.status, 200)
			const html = await response.text()
			const groups = [...html.matchAll(/<colgroup>(.*?)<\/colgroup>/gs)]
			assert.deepEqual(
				groups.map(([, contents]) => contents!.match(/<col\b/g)?.length ?? 0),
				columnCounts,
			)
			for (const [, contents] of groups) {
				assert.equal(contents!.replaceAll('<col/>', ''), '')
			}
			assert.match(html, /col:nth-of-type\(1\)/)
		}
	})
	it('renders scoped, nested and encoded names without redirecting or interpreting author HTML', async () => {
		for (const name of ['@fixture/community', 'fixture/with space#?%', 'fixture-λ']) {
			const { env, calls } = fixture()
			const path = routes.communityDetail.href({ name })
			const response = await request(path, env)
			const html = await response.text()
			assert.equal(response.status, 200)
			assertDocument(response, html)
			assert.deepEqual(calls, [name])
			assert.match(html, /aria-label="Exports"/)
			assert.match(html, /aria-label="Jobs"/)
			assert.ok(html.includes(`kody:${name}/helper`))
			assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
			assert.ok(html.includes('&lt;script&gt;untrusted instructions&lt;/script&gt;'))
			assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
			assert.ok(!html.includes('private-projection-sentinel'))
		}
	})
	it('retains HTTP 404 for an unpublished package and its native catalog link', async () => {
		const response = await request('/community/%40fixture%2Fmissing', fixture({ missing: true }).env)
		const html = await response.text()
		assert.equal(response.status, 404)
		assertDocument(response, html)
		assert.ok(html.includes('@fixture/missing'))
		assert.ok(html.includes('href="/community"'))
	})
	it('accepts HEAD for both catalog and package documents', async () => {
		for (const path of ['/community', '/community/%40fixture%2Fcommunity']) {
			const response = await request(path, fixture().env, 'HEAD')
			assert.equal(response.status, 200)
			assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
			await response.body?.cancel()
		}
	})
	it('refuses mutation methods before touching the registry', async () => {
		for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
			const response = await request('/community', {} as Env, method)
			assert.equal(response.status, 405)
			assert.equal(response.headers.get('allow'), 'GET, HEAD')
		}
	})
})
