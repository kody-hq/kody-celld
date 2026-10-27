import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	collapsedColumnMaxWidth,
	droppedColumnCollapseMaxWidth,
} from './record-table-columns.ts'

function trailingCollapse(
	columns: Array<{ drop?: 1 | 2 | 3 }>,
): Array<number | null> {
	return columns.map((_, index) =>
		collapsedColumnMaxWidth(columns, columns.length - 1 - index),
	)
}

describe('droppedColumnCollapseMaxWidth', () => {
	it('zeros each dropped column at its own threshold, never undropped ones', () => {
		const columns = [
			{ key: 'job' },
			{ key: 'schedule', drop: 3 as const },
			{ key: 'next', drop: 2 as const },
			{ key: 'last', drop: 2 as const },
			{ key: 'status', drop: 1 as const },
			{ key: 'actions' },
		]
		assert.deepEqual(
			columns.map((column) => droppedColumnCollapseMaxWidth(column)),
			[null, 900, 780, 780, 680, null],
		)
	})

	it('keeps Actions free when only middle columns drop', () => {
		assert.equal(droppedColumnCollapseMaxWidth({}), null)
		assert.equal(droppedColumnCollapseMaxWidth({ drop: 3 }), 900)
		assert.equal(droppedColumnCollapseMaxWidth({ drop: 1 }), 680)
	})
})

describe('collapsedColumnMaxWidth', () => {
	it('still documents the legacy trailing-N heuristic', () => {
		// Legacy: zeros trailing cols by drop count, which wrongly hits Actions
		// (last) when schedule (drop 3) hides first. Kept until callers move.
		assert.deepEqual(
			trailingCollapse([
				{},
				{ drop: 3 },
				{ drop: 2 },
				{ drop: 2 },
				{ drop: 1 },
				{},
			]),
			[null, null, 680, 780, 780, 900],
		)
	})
})
