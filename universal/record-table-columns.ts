/**
 * Container widths at which RecordTable columns drop out, widest first, and
 * which `drop` priorities are gone at each (client/routes/record-table.tsx).
 */
export const dropThresholds = [
	{ maxWidth: 900, drops: [3] },
	{ maxWidth: 780, drops: [2, 3] },
	{ maxWidth: 680, drops: [1, 2, 3] },
] as const

export type RecordTableDrop = 1 | 2 | 3

export type RecordTableColumnWidthSpec = {
	drop?: RecordTableDrop | undefined
	width?: string | undefined
}

/**
 * True when this column's cells are `display: none` at `containerMaxWidth`.
 */
export function isColumnDropped(
	column: { drop?: RecordTableDrop | undefined },
	containerMaxWidth: number,
): boolean {
	if (column.drop === undefined) return false
	for (const threshold of dropThresholds) {
		if (
			containerMaxWidth <= threshold.maxWidth &&
			(threshold.drops as ReadonlyArray<number>).includes(column.drop)
		) {
			return true
		}
	}
	return false
}

/**
 * Widths for each physical `<col>` once dropped cells leave the row.
 *
 * `display: none` on a middle cell packs later cells into earlier tracks, so
 * zeroing each dropped column's own `<col>` would put visible cells (e.g.
 * Actions) on a `width: 0` track. Instead: pack visible columns' widths into
 * the leading tracks and collapse only the trailing emptied ones.
 *
 * `null` means no explicit width (auto / remaining space). `0` means collapse.
 */
export function packedColWidths(
	columns: ReadonlyArray<RecordTableColumnWidthSpec>,
	containerMaxWidth: number,
): Array<string | 0 | null> {
	const visible = columns.filter(
		(column) => !isColumnDropped(column, containerMaxWidth),
	)
	if (visible.length === columns.length) {
		return columns.map((column) => column.width ?? null)
	}
	const packed: Array<string | 0 | null> = visible.map(
		(column) => column.width ?? null,
	)
	while (packed.length < columns.length) packed.push(0)
	return packed
}

/**
 * Container max-width at which this column's *own* cells drop, or null.
 * Prefer {@link packedColWidths} for `<col>` styling — this alone is not
 * enough when dropped cells use `display: none` (indices shift).
 */
export function droppedColumnCollapseMaxWidth(column: {
	drop?: RecordTableDrop | undefined
}): (typeof dropThresholds)[number]['maxWidth'] | null {
	if (column.drop === undefined) return null
	for (const threshold of dropThresholds) {
		if ((threshold.drops as ReadonlyArray<number>).includes(column.drop)) {
			return threshold.maxWidth
		}
	}
	return null
}

/**
 * @deprecated Prefer {@link packedColWidths}. The trailing-N heuristic zeros
 * end columns by drop *count*, which is the right *count* of trailing tracks
 * to clear after a shift, but does not reassign visible widths onto the
 * leading tracks those cells now occupy.
 */
export function collapsedColumnMaxWidth(
	columns: ReadonlyArray<{ drop?: RecordTableDrop | undefined }>,
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
