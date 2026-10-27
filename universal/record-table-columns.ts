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
 * ones. Collapse each dropped column's own `<col>` to zero width at the
 * threshold where its cells `display: none` — never the trailing visible
 * columns (Actions, primary, …).
 */
export function droppedColumnCollapseMaxWidth(column: {
	drop?: 1 | 2 | 3 | undefined
}): (typeof dropThresholds)[number]['maxWidth'] | null {
	if (column.drop === undefined) return null
	// Widest threshold first: the first one that hides this drop wins.
	for (const threshold of dropThresholds) {
		if ((threshold.drops as ReadonlyArray<number>).includes(column.drop)) {
			return threshold.maxWidth
		}
	}
	return null
}

/**
 * @deprecated Prefer {@link droppedColumnCollapseMaxWidth}. The trailing-N
 * heuristic zeroed visible end columns (e.g. Actions) whenever any earlier
 * column dropped — wrong when droppable columns sit in the middle.
 */
export function collapsedColumnMaxWidth(
	columns: ReadonlyArray<{ drop?: 1 | 2 | 3 | undefined }>,
	indexFromEnd: number,
): (typeof dropThresholds)[number]['maxWidth'] | null {
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
