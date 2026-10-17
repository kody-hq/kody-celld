/**
 * Pure port of denoland/celld v0.6.1 `celld_logic::epoch_gc::plan`
 * (crates/logic/epoch_gc.rs). Used only to lock the delete-safety invariants
 * we rely on when single mode enables CELLD_LTX_RETENTION_SECS. Keep this in
 * lockstep with that file when bumping CELLD_VERSION.
 *
 * An epoch is deleted only when every gate below passes. Anything uncertain
 * keeps the epoch (leak bytes; never drop a base a restore still needs).
 */

/**
 * @param {number} ownEpoch
 * @param {number[]} chain restore-chain epochs, oldest first (base at [0])
 * @param {{ epoch: number, newestMs: number }[]} listed
 * @param {number | null | undefined} recorded
 * @param {boolean} pinnedReads
 * @param {number} nowMs
 * @param {number} graceMs
 * @returns {{ retiredBelow: number, record: boolean, delete: number[] } | null}
 */
export function planEpochGc(ownEpoch, chain, listed, recorded, pinnedReads, nowMs, graceMs) {
	if (pinnedReads || chain.length === 0 || chain[chain.length - 1] !== ownEpoch) {
		return null
	}
	const base = chain[0]
	if (recorded != null && recorded > base) {
		return null
	}
	const deleteEpochs = listed
		.filter((row) => row.epoch < base && row.epoch + 1 < ownEpoch)
		.filter((row) => nowMs - row.newestMs >= graceMs)
		.map((row) => row.epoch)
	return {
		retiredBelow: base,
		record: recorded !== base,
		delete: deleteEpochs,
	}
}
