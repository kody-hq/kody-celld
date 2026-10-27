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
		assert.match(cssSource, /@container \(max-width: 620px\)/)
		assert.doesNotMatch(cssSource, /paddingLeft: '0\.65rem'/)
	})

	it('job detail Run now also shows Running… while the POST is in flight', () => {
		const detail = readFileSync(here('../../client/routes/account-jobs-detail.tsx'), 'utf8')
		assert.match(detail, /pendingLabel="Running…"/)
		assert.match(detail, /primaryLinkCss/)
	})

	it('job detail IdValue uses a wrapping sm ghost Copy; chip stays one-line', () => {
		const detail = readFileSync(here('../../client/routes/account-jobs-detail.tsx'), 'utf8')
		assert.match(detail, /copy="ghost"/)
		assert.match(detail, /wide: true/)
		const idValue = readFileSync(here('../../client/routes/account-management-components.tsx'), 'utf8')
		assert.match(idValue, /const wrap = handle\.props\.copy === 'ghost'/)
		assert.match(idValue, /variant=\{wrap \? 'ghost' : 'chip'\}/)
		assert.match(idValue, /size=\{wrap \? 'sm' : undefined\}/)
		assert.match(idValue, /embedded=\{wrap \|\| undefined\}/)
		assert.match(idValue, /overflowWrap: 'break-word'/)
		assert.match(idValue, /textOverflow: 'ellipsis'/)
		assert.match(idValue, /borderLeft: `1px solid \$\{colors\.border\}`/)
		assert.match(idValue, /embedded` on the button/)
		assert.match(idValue, /main:has\(> \[data-page-flash\]\) > &/)
		assert.match(idValue, /gridColumn: '1 \/ -1'/)
		const copyBtn = readFileSync(here('../../client/copy-text-button.tsx'), 'utf8')
		assert.match(copyBtn, /embedded\?: boolean/)
		assert.match(copyBtn, /embeddedGhostCopyButtonCss/)
		assert.match(copyBtn, /width: '4\.5rem'/)
	})

	it('jobs list uses primary link styling and wraps the job name at slashes', () => {
		const jobsList = readFileSync(here('../../client/routes/account-jobs.tsx'), 'utf8')
		assert.match(jobsList, /primaryLinkCss/)
		assert.match(jobsList, /wrap: true/)
		assert.match(jobsList, /width: '8\.5rem'/)
		assert.match(jobsList, /\\u2011/)
		assert.match(jobsList, /\\u200B/)
	})
})
