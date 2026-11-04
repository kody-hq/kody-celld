import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { URL } from 'node:url'
import { runInNewContext } from 'node:vm'

const source = readFileSync(
	new URL('../../public/one-time-document.js', import.meta.url),
	'utf8',
)

function boot(fields: Array<{ value: string }> = []) {
	const events = new EventTarget()
	const element = { hidden: false }
	const navigations: string[] = []
	runInNewContext(source, {
		URL,
		addEventListener: events.addEventListener.bind(events),
		document: {
			documentElement: element,
			querySelectorAll(selector: string) {
				assert.equal(selector, '[data-sensitive-value]')
				return fields
			},
		},
		location: {
			href: 'https://fixture.example.invalid/account/tokens?view=list#receipt',
			replace: (url: string) => navigations.push(url),
		},
	})
	return {
		element,
		navigations,
		dispatch(type: string, persisted: boolean) {
			events.dispatchEvent(Object.assign(new Event(type), { persisted }))
		},
	}
}

describe('sensitive document lifecycle', () => {
	it('leaves the initial receipt visible without refreshing or replaying its POST', () => {
		const page = boot()
		page.dispatch('pageshow', false)
		assert.equal(page.element.hidden, false)
		assert.deepEqual(page.navigations, [])
	})

	it('hides the receipt before either cached or ordinary document departure', () => {
		for (const persisted of [false, true]) {
			const page = boot()
			page.dispatch('pagehide', persisted)
			assert.equal(page.element.hidden, true)
			assert.deepEqual(page.navigations, [])
		}
	})

	it('keeps a restored receipt hidden while replacing it with a fresh fragment-free GET', () => {
		const page = boot()
		page.dispatch('pagehide', true)
		page.dispatch('pageshow', true)
		assert.equal(page.element.hidden, true)
		assert.deepEqual(page.navigations, [
			'https://fixture.example.invalid/account/tokens?view=list',
		])
	})

	it('clears every marked private field before cached or ordinary departure', () => {
		for (const persisted of [false, true]) {
			const fields = [
				{ value: 'inert field fixture' },
				{ value: 'another fixture' },
			]
			const page = boot(fields)
			page.dispatch('pageshow', false)
			assert.equal(fields[0]?.value, 'inert field fixture')
			page.dispatch('pagehide', persisted)
			assert.ok(page.element.hidden)
			assert.deepEqual(
				fields.map((field) => field.value),
				['', ''],
			)
			page.dispatch('pageshow', true)
			assert.deepEqual(
				fields.map((field) => field.value),
				['', ''],
			)
		}
	})
})
