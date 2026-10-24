import assert from 'node:assert/strict'
import test from 'node:test'
import { runList } from './runs.ts'

test('runList forwards workflow_id to the run store', async () => {
	let filter: unknown
	const result = await runList.handler({ workflow_id: 'pkgwf-123' }, {
		userCell: {
			runList: async (input: unknown) => {
				filter = input
				return []
			},
		},
	} as never)
	assert.deepEqual(filter, { limit: undefined, errorTriage: 'all', workflowId: 'pkgwf-123' })
	assert.deepEqual(result, { runs: [] })
})
