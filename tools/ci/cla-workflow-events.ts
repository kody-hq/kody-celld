/**
 * Event helpers for `.github/workflows/cla.yml`.
 *
 * The CLA check runs only on `pull_request_target` (fork and same-repo).
 * Checkout is the base branch tip only; never PR head. Keep the workflow
 * `if:` and the post-sign re-run lookup in sync with these helpers.
 */

export type ClaCheckEventName = 'pull_request_target'

export type ClaWorkflowRunSummary = {
	id: number
	event: string
	status: string
	conclusion: string | null
}

/**
 * Event order for post-sign re-run lookup after the interim `pull_request`
 * trigger was removed (issue #99).
 */
export function claRerunEventOrder(): Array<ClaCheckEventName> {
	return ['pull_request_target']
}

/**
 * Pick a workflow run that is worth waiting on or re-running. Skipped runs
 * are ignored so we do not re-trigger a no-op while a real check stays red.
 */
export function pickClaRerunCandidate(runs: Array<ClaWorkflowRunSummary>): ClaWorkflowRunSummary | null {
	for (const run of runs) {
		if (run.status !== 'completed') {
			return run
		}
		if (run.conclusion !== 'skipped') {
			return run
		}
	}
	return null
}
