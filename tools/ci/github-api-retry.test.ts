import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { githubApiErrorStatus, isRetryableGithubApiError, isRetryableGithubNetworkError, withGithubApiRetry } = require(
	join(dirname(fileURLToPath(import.meta.url)), 'github-api-retry.cjs'),
) as {
	githubApiErrorStatus: (error: unknown) => number | undefined
	isRetryableGithubApiError: (error: unknown) => boolean
	isRetryableGithubNetworkError: (error: unknown) => boolean
	withGithubApiRetry: <T>(
		run: () => Promise<T>,
		options?: {
			maxAttempts?: number
			baseDelayMs?: number
			sleep?: (ms: number) => Promise<void>
			isRetryable?: (error: unknown) => boolean
			onRetry?: (input: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void
		},
	) => Promise<T>
}

function httpError(status: number, message = 'Server Error') {
	const error = new Error(message) as Error & {
		status: number
		response: { status: number }
	}
	error.name = 'HttpError'
	error.status = status
	error.response = { status }
	return error
}

describe('github-api-retry', () => {
	it('reads Octokit status and response.status for retryability', () => {
		assert.equal(isRetryableGithubApiError(httpError(502)), true)
		assert.equal(isRetryableGithubApiError(httpError(404)), false)
		assert.equal(isRetryableGithubApiError(new Error('no status')), false)
		assert.equal(isRetryableGithubApiError({ response: { status: 503 } }), true)
		assert.equal(githubApiErrorStatus(httpError(502)), 502)
		assert.equal(githubApiErrorStatus(null), undefined)
	})

	it('treats transport failures without status as retryable', () => {
		const reset = new Error('upstream connect error or disconnect/reset before headers') as Error & { code?: string }
		reset.code = 'ECONNRESET'
		assert.equal(isRetryableGithubNetworkError(reset), true)
		assert.equal(isRetryableGithubApiError(reset), true)
		assert.equal(
			isRetryableGithubApiError(
				new Error(
					'upstream connect error or disconnect/reset before headers. retried and the latest reset reason: connection termination',
				),
			),
			true,
		)
		assert.equal(isRetryableGithubApiError(new Error('permission denied')), false)
		assert.equal(isRetryableGithubApiError(httpError(403, 'Forbidden')), false)
	})

	it('CLA record soft-exit path: exhausted 5xx stays retryable; 403 does not', async () => {
		await assert.rejects(
			withGithubApiRetry(
				async () => {
					throw httpError(503, 'upstream connect error or disconnect/reset before headers')
				},
				{ maxAttempts: 5, baseDelayMs: 8_000, sleep: async () => {} },
			),
			(error: unknown) => typeof error === 'object' && error !== null && 'status' in error && error.status === 503,
		)

		let forbiddenAttempts = 0
		await assert.rejects(
			withGithubApiRetry(async () => {
				forbiddenAttempts += 1
				throw httpError(403, 'Resource not accessible by integration')
			}),
			(error: unknown) => typeof error === 'object' && error !== null && 'status' in error && error.status === 403,
		)
		assert.equal(forbiddenAttempts, 1)
		assert.equal(
			isRetryableGithubApiError(httpError(503, 'upstream connect error or disconnect/reset before headers')),
			true,
		)
		assert.equal(isRetryableGithubApiError(httpError(403, 'Resource not accessible by integration')), false)
	})

	it('retries 5xx with exponential backoff then succeeds', async () => {
		const sleeps: Array<number> = []
		const retries: Array<number> = []
		let attempts = 0
		const result = await withGithubApiRetry(
			async () => {
				attempts += 1
				if (attempts < 3) throw httpError(502)
				return 'ok'
			},
			{
				baseDelayMs: 10,
				sleep: async (ms) => {
					sleeps.push(ms)
				},
				onRetry: ({ attempt }) => {
					retries.push(attempt)
				},
			},
		)
		assert.equal(result, 'ok')
		assert.equal(attempts, 3)
		assert.deepEqual(retries, [1, 2])
		assert.deepEqual(sleeps, [10, 20])
	})

	it('does not retry 4xx and surfaces the error', async () => {
		let attempts = 0
		await assert.rejects(
			withGithubApiRetry(async () => {
				attempts += 1
				throw httpError(403, 'Forbidden')
			}),
			(error: unknown) => typeof error === 'object' && error !== null && 'status' in error && error.status === 403,
		)
		assert.equal(attempts, 1)
	})

	it('exhausts attempts on persistent 5xx', async () => {
		let attempts = 0
		await assert.rejects(
			withGithubApiRetry(
				async () => {
					attempts += 1
					throw httpError(504)
				},
				{ maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} },
			),
			(error: unknown) => typeof error === 'object' && error !== null && 'status' in error && error.status === 504,
		)
		assert.equal(attempts, 3)
	})
})
