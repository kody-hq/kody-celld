import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderStartDocument } from '../app/start-render.ts'
import type { JobView } from '#universal/loader-data.ts'

const job: JobView = {
	id: '@fixture/cron-kit#nightly',
	packageName: '@fixture/cron-kit',
	jobName: 'nightly/clean-up',
	description: 'Cleanup <fixture>',
	schedule: '0 2 * * *',
	timezone: 'America/Denver',
	enabled: true,
	nextRunAt: '2026-01-02T09:00:00Z',
	lastRunAt: null,
	lastStatus: null,
	lastError: null,
}
async function render(detail = false) {
	const pathname = detail ? '/account/jobs/%40fixture%2Fcron-kit%23nightly' : '/account/jobs'
	const response = await renderStartDocument(new Request(`http://localhost${pathname}`), {
		title: 'Jobs',
		pathname,
		data: detail
			? {
					page: 'accountJobDetail',
					csrf: 'fixture-csrf',
					job: { ...job, entry: './jobs.ts#nightly' },
					packageExists: true,
					runs: [],
				}
			: { page: 'accountJobs', csrf: 'fixture-csrf', jobs: [job] },
	})
	assert.equal(response.status, 200)
	return (await response.text()).replace(/<!--[\s\S]*?-->/g, '')
}
describe('jobs native actions and layout', () => {
	it('renders equal-width inline actions with narrow-card stacking', async () => {
		const html = await render()
		for (const declaration of [
			'grid-auto-flow:column',
			'grid-auto-columns:1fr',
			'width:max-content',
			'min-width:6.75rem',
		])
			assert.ok(html.includes(declaration), declaration)
		assert.match(html, /@container\s*\(max-width:\s*620px\)/)
		assert.match(html, />Run now<\/button>/)
		assert.match(html, />Pause<\/button>/)
	})
	it('renders native run/toggle POSTs with CSRF on the detail document', async () => {
		const html = await render(true)
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
			.map(([s]) => s)
			.filter((s) => s.includes('action="/account/jobs/'))
		assert.equal(forms.length, 2)
		for (const form of forms) {
			assert.match(form, /method="post"/)
			assert.match(form, /name="csrf"[^>]*value="fixture-csrf"/)
			assert.match(form, /name="id"[^>]*value="@fixture\/cron-kit#nightly"/)
		}
		assert.ok(forms.some((s) => /name="action"[^>]*value="run"/.test(s)))
		assert.ok(forms.some((s) => /name="action"[^>]*value="toggle"/.test(s)))
	})
	it('retains the wrapping job-id copy segment and native package link', async () => {
		const html = await render(true)
		assert.match(html, /aria-label="Copy job id"/)
		assert.match(html, /grid-column:1\s*\/\s*-1/)
		for (const declaration of ['overflow-wrap:break-word', 'width:4.5rem'])
			assert.ok(html.includes(declaration), declaration)
		assert.match(html, /href="\/account\/packages\/%40fixture%2Fcron-kit"/)
	})
	it('renders native detail links and escaped, wrappable job names', async () => {
		const html = await render()
		assert.match(html, /href="\/account\/jobs\/%40fixture%2Fcron-kit%23nightly"/)
		assert.ok(html.includes('nightly/\u200Bclean\u2011up'))
		assert.ok(html.includes('Cleanup &lt;fixture&gt;'))
		assert.ok(!html.includes('Cleanup <fixture>'))
	})
})
