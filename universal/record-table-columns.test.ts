import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	collapsedColumnMaxWidth,
	droppedColumnCollapseMaxWidth,
	isColumnDropped,
	packedColWidths,
} from './record-table-columns.ts'

/** Jobs list column specs (mirrors client/routes/account-jobs.tsx). */
const jobsColumns = [
	{ key: 'job' },
	{ key: 'schedule', drop: 3 as const },
	{ key: 'next', drop: 2 as const, width: '11.75rem' },
	{ key: 'last', drop: 3 as const, width: '11.75rem' },
	{ key: 'status', drop: 1 as const, width: '5.25rem' },
	{ key: 'actions', width: '16.25rem' },
]

function trailingCollapse(
	columns: Array<{ drop?: 1 | 2 | 3 }>,
): Array<number | null> {
	return columns.map((_, index) =>
		collapsedColumnMaxWidth(columns, columns.length - 1 - index),
	)
}

describe('packedColWidths', () => {
	it('keeps each column on its own track when nothing has dropped', () => {
		assert.deepEqual(packedColWidths(jobsColumns, 901), [
			null,
			null,
			'11.75rem',
			'11.75rem',
			'5.25rem',
			'16.25rem',
		])
	})

	it('packs visible widths left after Schedule+Last drop so Actions is not zeroed', () => {
		// display:none removes Schedule and Last (both drop 3); cells slide
		// onto earlier <col>s. Actions must keep 16.25rem on the track it now
		// occupies — not sit on a width:0 middle col (Bugbot: visible cells
		// get zero width).
		assert.deepEqual(packedColWidths(jobsColumns, 850), [
			null,
			'11.75rem',
			'5.25rem',
			'16.25rem',
			0,
			0,
		])
		assert.equal(isColumnDropped(jobsColumns[1]!, 850), true)
		assert.equal(isColumnDropped(jobsColumns[3]!, 850), true)
		assert.equal(isColumnDropped(jobsColumns[5]!, 850), false)
	})

	it('packs Job + Status + Actions at mid width without clipping Actions', () => {
		assert.deepEqual(packedColWidths(jobsColumns, 750), [
			null,
			'5.25rem',
			'16.25rem',
			0,
			0,
			0,
		])
	})

	it('packs Job + Actions once Status drops', () => {
		assert.deepEqual(packedColWidths(jobsColumns, 680), [
			null,
			'16.25rem',
			0,
			0,
			0,
			0,
		])
	})
})

describe('droppedColumnCollapseMaxWidth', () => {
	it('reports each column own drop threshold (insufficient alone under display:none)', () => {
		assert.deepEqual(
			jobsColumns.map((column) => droppedColumnCollapseMaxWidth(column)),
			[null, 900, 780, 900, 680, null],
		)
	})

	it('alone would leave Actions width on an emptied trailing track at 850', () => {
		// Documents why packedColWidths exists: own-col collapse zeros
		// Schedule+Last in place, so shifted cells land on the wrong tracks
		// while Actions' 16.25rem sits on an empty trailing col.
		assert.equal(droppedColumnCollapseMaxWidth(jobsColumns[1]!), 900)
		assert.equal(droppedColumnCollapseMaxWidth(jobsColumns[5]!), null)
		const ownCollapseAt850 = jobsColumns.map((column) => {
			const at = droppedColumnCollapseMaxWidth(column)
			return at !== null && 850 <= at ? 0 : (column.width ?? null)
		})
		assert.deepEqual(ownCollapseAt850, [
			null,
			0,
			'11.75rem',
			0,
			'5.25rem',
			'16.25rem',
		])
		assert.notDeepEqual(ownCollapseAt850, packedColWidths(jobsColumns, 850))
	})
})

describe('collapsedColumnMaxWidth', () => {
	it('still documents the legacy trailing-N heuristic', () => {
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
