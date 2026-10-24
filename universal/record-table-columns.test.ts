import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collapsedColumnMaxWidth } from './record-table-columns.ts'

// The Email page's columns: subject, received (2), from (1), class (3), size (3).
const email = [{}, { drop: 2 }, { drop: 1 }, { drop: 3 }, { drop: 3 }] as const
const at = (columns: ReadonlyArray<{ drop?: 1 | 2 | 3 }>) =>
	columns.map((_, index) =>
		collapsedColumnMaxWidth(columns, columns.length - 1 - index),
	)

describe('collapsedColumnMaxWidth', () => {
	it('collapses as many trailing cols as columns are dropped at each width', () => {
		// <=900 drops class + size (2 cols), <=780 adds received (3), <=680 adds from (4).
		assert.deepEqual(at(email), [null, 680, 780, 900, 900])
	})

	it('leaves every col alone when nothing drops', () => {
		assert.deepEqual(at([{}, {}, {}]), [null, null, null])
	})

	it('counts dropped columns wherever they sit, not just at the end', () => {
		// One drop-1 column in the middle still frees exactly one trailing col.
		assert.deepEqual(at([{}, { drop: 1 }, {}]), [null, null, 680])
	})
})
