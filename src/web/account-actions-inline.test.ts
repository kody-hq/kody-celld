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

		const cssSource = readFileSync(here('../../client/routes/account-management-components.tsx'), 'utf8')
		assert.match(cssSource, /export const accountActionsInlineCss/)
		assert.match(cssSource, /flexWrap: 'nowrap'/)
		assert.match(cssSource, /paddingLeft: '0\.65rem'/)
	})

	it('job detail Run now also shows Running… while the POST is in flight', () => {
		const detail = readFileSync(here('../../client/routes/account-jobs-detail.tsx'), 'utf8')
		assert.match(detail, /pendingLabel="Running…"/)
	})
})
