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
		assert.match(jobsList, /width: '16\.25rem'/)

		const cssSource = readFileSync(here('../../client/routes/account-management-components.tsx'), 'utf8')
		assert.match(cssSource, /export const accountActionsInlineCss/)
		assert.match(cssSource, /gridAutoFlow: 'column'/)
		assert.match(cssSource, /gridAutoColumns: '1fr'/)
		assert.match(cssSource, /width: 'max-content'/)
		assert.match(cssSource, /gap: '0\.7rem'/)
		assert.match(cssSource, /minWidth: '6\.75rem'/)
		assert.doesNotMatch(cssSource, /paddingLeft: '0\.65rem'/)
	})

	it('job detail Run now also shows Running… while the POST is in flight', () => {
		const detail = readFileSync(here('../../client/routes/account-jobs-detail.tsx'), 'utf8')
		assert.match(detail, /pendingLabel="Running…"/)
		assert.match(detail, /primaryLinkCss/)
	})

	it('job detail IdValue keeps a compact copy control beside the id', () => {
		const detail = readFileSync(here('../../client/routes/account-jobs-detail.tsx'), 'utf8')
		assert.match(detail, /copy="ghost"/)
		const idValue = readFileSync(here('../../client/routes/account-management-components.tsx'), 'utf8')
		assert.match(idValue, /variant="chip"/)
		assert.match(idValue, /overflowWrap: 'anywhere'/)
		assert.match(idValue, /borderLeft: `1px solid \$\{colors\.border\}`/)
		assert.match(idValue, /Wrapper owns the segment chrome/)
	})

	it('jobs list uses primary link styling and wraps the job name', () => {
		const jobsList = readFileSync(here('../../client/routes/account-jobs.tsx'), 'utf8')
		assert.match(jobsList, /primaryLinkCss/)
		assert.match(jobsList, /wrap: true/)
	})
})
