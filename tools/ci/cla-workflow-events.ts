/**
 * Event routing for `.github/workflows/cla.yml` job `cla`.
 *
 * Mirrored in the workflow `if:` expression and the record job's re-run
 * lookup. Keep them in sync.
 *
 * Why two triggers exist (interim):
 * - `pull_request` gives fork PRs a read-only GITHUB_TOKEN, so comment steps 403.
 * - `pull_request_target` gives a write token but runs the workflow from the
 *   base ref, so the introducing PR cannot rely on it until that file is on
 *   main.
 *
 * After cleanup removes `pull_request`, call sites should pass only
 * `pull_request_target` and this helper can collapse to "always run".
 */
export type ClaCheckEventName = 'pull_request' | 'pull_request_target'

export type ClaCheckEventRouteInput = {
	eventName: ClaCheckEventName
	/** `github.event.pull_request.head.repo.full_name` */
	headRepoFullName: string
	/** `github.repository` (owner/name of the base repo) */
	baseRepoFullName: string
}

export type ClaWorkflowRunSummary = {
	id: number
	event: string
	status: string
	conclusion: string | null
}

/**
 * Returns whether the CLA check job should run for this event.
 * Forks: only `pull_request_target`. Same-repo: only `pull_request` (interim).
 */
export function shouldRunClaCheckJob(input: ClaCheckEventRouteInput): boolean {
	const isFork = input.headRepoFullName !== input.baseRepoFullName
	if (input.eventName === 'pull_request_target') {
		return isFork
	}
	if (input.eventName === 'pull_request') {
		return !isFork
	}
	const _exhaustive: never = input.eventName
	return _exhaustive
}

/**
 * Event order for post-sign re-run lookup: the event whose `cla` job actually
 * ran for this PR, then the other as a fallback.
 */
export function claRerunEventOrder(input: {
	headRepoFullName: string
	baseRepoFullName: string
}): Array<ClaCheckEventName> {
	const isFork = input.headRepoFullName !== input.baseRepoFullName
	return isFork ? ['pull_request_target', 'pull_request'] : ['pull_request', 'pull_request_target']
}

/**
 * Pick a workflow run that is worth waiting on or re-running. Skipped runs
 * (same-repo `pull_request_target` / fork `pull_request`) are ignored so we
 * do not re-trigger a no-op while the real check stays red.
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
