/**
 * Container widths at which RecordTable columns drop out, widest first, and
 * which `drop` priorities are gone at each (client/routes/record-table.tsx).
 */
export const dropThresholds = [
	{ maxWidth: 900, drops: [3] },
	{ maxWidth: 780, drops: [2, 3] },
	{ maxWidth: 680, drops: [1, 2, 3] },
] as const

/**
 * `table-layout: fixed` takes column widths from the first row, but the
 * expanded record's `colSpan` still counts dropped columns, so without this
 * a narrowed table left blank tracks for them and squeezed the visible
 * ones. Dropped cells shift the rest left, so what matters is how many are
 * gone: the last that many `<col>`s collapse to zero width. Null when the
 * column at `indexFromEnd` never collapses.
 */
export function collapsedColumnMaxWidth(
	columns: ReadonlyArray<{ drop?: 1 | 2 | 3 | undefined }>,
	indexFromEnd: number,
): (typeof dropThresholds)[number]['maxWidth'] | null {
	// Widest threshold first: the first one that hides enough columns wins.
	for (const threshold of dropThresholds) {
		const hidden = columns.filter(
			(column) =>
				column.drop !== undefined &&
				(threshold.drops as ReadonlyArray<number>).includes(column.drop),
		).length
		if (hidden > indexFromEnd) return threshold.maxWidth
	}
	return null
}
