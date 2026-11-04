import assert from 'node:assert/strict'
import { globSync } from 'node:fs'
import { it } from 'node:test'
import { URL } from 'node:url'
import { createMemoryHistory } from '@tanstack/react-router'

const assets = new URL('../../.start/server/assets/', import.meta.url)
const modules = globSync('router-*.js', { cwd: assets })
assert.equal(modules.length, 1)
const { getRouter } = await import(new URL(modules[0]!, assets).href)

for (const href of [
	'/oauth/authorize?client_id=%E0%A4%A',
	'/oauth/authorize?client_id=%&state=a%20b',
	'/oauth/authorize?client_id=%80&scope=openid+profile',
	'/oauth/authorize?client_id=a&client_id=b',
	'/account/packages?q=a%20b&sort=created',
	'/account/memories?search=%22value%22&deleted=true&limit=10',
	'/community/%E2%9C%93?filter=%2f',
	'/account/mcp-servers/%E0%A4%A/authorize?state=%E0%A4%A',
	'/account/mcp-servers/%/authorize?state=a%20b',
	'/oauth/authorize?client_id=%E2%9C%93&state=literal%25percent',
	'/oauth/authorize?client_id=a&scope=openid&state=fixture#permissions',
	'/community/%e2%9c%93',
	'/community/%61',
	'/community/%25literal',
	'/community/%5cliteral',
	'/community/%3F%23%2F',
	'/community/%0a',
	'/community/%00%09%0d%1f%7f',
	'/community/%22%3c%3e%60%7b%7d',
	'/account/packages/%40fixture%2Fexample/files/a%25b.ts',
]) {
	it(
		'keeps the public URL unchanged during document hydration: ' + href,
		() => {
			const router = getRouter()
			router.update({
				history: createMemoryHistory({ initialEntries: [href] }),
				origin: 'http://localhost',
				isServer: false,
			})
			router.updateLatestLocation()
			const location = router.latestLocation
			router.stores.location.set(location)
			const canonical = router.buildLocation({
				to: location.pathname,
				search: true,
				params: true,
				hash: true,
				state: true,
				_includeValidateSearch: true,
			})
			assert.equal(location.publicHref, href)
			assert.equal(canonical.publicHref, href)
		},
	)
}

it('preserves the current query without overwriting a different destination query', () => {
	const router = getRouter()
	router.update({
		history: createMemoryHistory({
			initialEntries: ['/account/packages?q=a%20b'],
		}),
		origin: 'http://localhost',
		isServer: false,
	})
	router.updateLatestLocation()
	router.stores.location.set(router.latestLocation)
	assert.equal(
		router.buildLocation({
			to: '/account/packages',
			search: { q: 'other value' },
		}).publicHref,
		'/account/packages?q=other+value',
	)
})

it('refreshes URI spellings when the current public history entry changes', () => {
	const router = getRouter()
	const history = createMemoryHistory({
		initialEntries: ['/community/%61?q=a%20b'],
	})
	router.update({ history, origin: 'http://localhost', isServer: false })
	for (const href of [
		'/community/%61?q=a%20b',
		'/community/a?q=a+b',
		'/community/%61?q=a%20b',
	]) {
		history.replace(href)
		router.updateLatestLocation()
		const location = router.latestLocation
		router.stores.location.set(location)
		assert.equal(
			router.buildLocation({ to: location.pathname, search: true }).publicHref,
			href,
		)
	}
})
