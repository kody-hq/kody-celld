/**
 * Event routing for `.github/workflows/cla.yml` job `cla`.
 *
 * Mirrored in the workflow `if:` expression. Keep them in sync.
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
