/**
 * Whether a run may open the storage of `packageName`. The name reaches the
 * host from sandbox code, so it only counts for the package the run belongs to
 * or one the host built into the run's module graph.
 */
export function runMayOpenPackageStorage(
	run: { packageName: string | null; graphPackages?: ReadonlyArray<string> | undefined },
	packageName: string,
) {
	return packageName === run.packageName || (run.graphPackages?.includes(packageName) ?? false)
}
