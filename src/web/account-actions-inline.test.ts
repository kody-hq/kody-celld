import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

describe('jobs list action row', () => {
	it('uses inline Actions so Run now and Pause stay on one line', () => {
		const jobsList = readFileSync(
			fileURLToPath(new URL('../../client/routes/account-jobs.tsx', import.meta.url)),
			'utf8',
		)
		assert.match(jobsList, /layout="inline"/)
		assert.match(jobsList, /pendingLabel="Running…"/)

		const cssSource = readFileSync(
			fileURLToPath(new URL('../../client/routes/account-management-components.tsx', import.meta.url)),
			'utf8',
		)
		assert.match(cssSource, /export const accountActionsInlineCss/)
		assert.match(cssSource, /flexWrap: 'nowrap'/)
	})

	it('job detail Run now also shows Running… while the POST is in flight', () => {
		const detail = readFileSync(
			fileURLToPath(new URL('../../client/routes/account-jobs-detail.tsx', import.meta.url)),
			'utf8',
		)
		assert.match(detail, /pendingLabel="Running…"/)
	})
})
