import type { Env } from '../env.ts'
import { limitsFromEnv } from '../lib/limits.ts'
import { verifyAppRunToken } from './tokens.ts'

/** Ties every failure report of one app request to one run row (`runStart` replays on a repeat). */
export function appRunIdempotencyKey(runId: string) {
	return `app:${runId}`
}

/** The `app_<id>` request id behind an app run's idempotency key, or null. */
export function appRunIdFromIdempotencyKey(key: string | null | undefined): string | null {
	return key?.startsWith('app:app_') ? key.slice('app:'.length) : null
}

/**
 * Package apps record failures only: a build error, a throw, a >= 500 response,
 * a timeout, or a body over the byte cap. The host and the app wrapper can both
 * report one request (a 504 followed by a late throw); the idempotency key keeps
 * that to one run.
 */
export async function recordAppFailure(
	env: Env,
	input: {
		userId: string
		packageName: string
		runId: string
		error: { name: string; message: string }
		logs?: Array<unknown>
	},
) {
	try {
		const userCell = env.USER.getByName(input.userId)
		const { run, replayed } = await userCell.runStart({
			kind: 'app',
			packageName: input.packageName,
			idempotencyKey: appRunIdempotencyKey(input.runId),
		})
		if (replayed) return
		await userCell.runFinish({
			id: run.id,
			status: 'error',
			error: input.error,
			logsJson: JSON.stringify((input.logs ?? []).slice(0, limitsFromEnv(env).runLogLimit)),
			durationMs: 0,
		})
	} catch (error) {
		console.warn('[kody-celld] package-app run report failed', error)
	}
}

export type AppReportProps = { userId: string; packageName: string | null; app?: boolean }

/**
 * `RuntimeHost.appRunReport`: only an isolate the host loaded as an app (props),
 * holding the token the host minted for this request, can write an `app` run,
 * and only one per request. Returns whether the report was accepted.
 */
export async function acceptAppRunReport(
	env: Env,
	props: AppReportProps,
	input: {
		token?: unknown
		status?: unknown
		error?: { name?: unknown; message?: unknown } | null
		logs?: unknown
	},
): Promise<boolean> {
	if (props.app !== true || !props.packageName) return false
	if (typeof input?.token !== 'string') return false
	const claims = await verifyAppRunToken(env.KODY_MASTER_KEY, input.token, {
		uid: props.userId,
		pkg: props.packageName,
	})
	if (!claims) return false
	const status = typeof input.status === 'number' ? input.status : 500
	const error =
		input.error && typeof input.error.name === 'string' && typeof input.error.message === 'string'
			? { name: input.error.name.slice(0, 200), message: input.error.message.slice(0, 2000) }
			: { name: 'app_http_error', message: `The app responded ${status}.` }
	await recordAppFailure(env, {
		userId: props.userId,
		packageName: props.packageName,
		runId: claims.rid,
		error,
		logs: Array.isArray(input.logs) ? input.logs : [],
	})
	return true
}
