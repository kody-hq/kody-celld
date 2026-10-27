import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url).href)

describe('jobs list action row', () => {
	it('uses inline Actions so Run now and Pause stay on one line', () => {
		const jobsList = readFileSync(here('../../client/routes/account-jobs.tsx'), 'utf8')
		assert.match(jobsList, /layout="inline"/)
		assert.match(jobsList, /pendingLabel="Running…"/)
		assert.match(jobsList, /width: '16\.5rem'/)

		const cssSource = readFileSync(here('../../client/routes/account-management-components.tsx'), 'utf8')
		assert.match(cssSource, /export const accountActionsInlineCss/)
		assert.match(cssSource, /flexWrap: 'nowrap'/)
		assert.match(cssSource, /width: 'max-content'/)
		assert.match(cssSource, /gap: '0\.7rem'/)
		assert.doesNotMatch(cssSource, /paddingLeft: '0\.65rem'/)
	})

	it('job detail Run now also shows Running… while the POST is in flight', () => {
		const detail = readFileSync(here('../../client/routes/account-jobs-detail.tsx'), 'utf8')
		assert.match(detail, /pendingLabel="Running…"/)
		assert.match(detail, /primaryLinkCss/)
	})

	it('job detail IdValue copy uses the account sm ghost pill', () => {
		const detail = readFileSync(here('../../client/routes/account-jobs-detail.tsx'), 'utf8')
		assert.match(detail, /copy="ghost"/)
	})
})
