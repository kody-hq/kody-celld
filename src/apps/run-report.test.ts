import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Env } from '../env.ts'
import { acceptAppRunReport, appRunIdempotencyKey, appRunIdFromIdempotencyKey, recordAppFailure } from './run-report.ts'
import { mintAppRunToken } from './tokens.ts'

const masterKey = 'test-master-key-0123456789abcdef0123456789'

/** A user cell whose `runStart` honours idempotency keys like the real one. */
function fakeEnv() {
	const runs: Array<{ id: string; idempotencyKey: string | null; packageName: string | null; error?: unknown }> = []
	const userCell = {
		async runStart(input: { kind: string; packageName?: string | null; idempotencyKey?: string | null }) {
			const existing = input.idempotencyKey ? runs.find((r) => r.idempotencyKey === input.idempotencyKey) : undefined
			if (existing) return { run: existing, replayed: true }
			const run = {
				id: `run_${runs.length + 1}`,
				idempotencyKey: input.idempotencyKey ?? null,
				packageName: input.packageName ?? null,
			}
			runs.push(run)
			return { run, replayed: false }
		},
		async runFinish(input: { id: string; error?: unknown }) {
			const run = runs.find((r) => r.id === input.id)
			if (run) run.error = input.error
		},
	}
	const env = { KODY_MASTER_KEY: masterKey, USER: { getByName: () => userCell } } as unknown as Env
	return { env, runs }
}

const props = { userId: 'user_a', email: 'a@example.com', packageName: '@t/app', app: true as const }

describe('recordAppFailure', () => {
	it('records at most one run per app request id', async () => {
		const { env, runs } = fakeEnv()
		const base = { userId: 'user_a', packageName: '@t/app', runId: 'app_1' }
		await recordAppFailure(env, { ...base, error: { name: 'app_timeout', message: 'late' } })
		await recordAppFailure(env, { ...base, error: { name: 'Error', message: 'thrown after the 504' } })
		assert.equal(runs.length, 1)
		assert.equal(runs[0]?.idempotencyKey, appRunIdempotencyKey('app_1'))
		assert.deepEqual(runs[0]?.error, { name: 'app_timeout', message: 'late' })
		await recordAppFailure(env, { ...base, runId: 'app_2', error: { name: 'Error', message: 'other request' } })
		assert.equal(runs.length, 2)
	})
})

describe('appRunIdFromIdempotencyKey', () => {
	it('round-trips app request ids and ignores other keys', () => {
		assert.equal(appRunIdFromIdempotencyKey(appRunIdempotencyKey('app_1')), 'app_1')
		assert.equal(appRunIdFromIdempotencyKey('app:run_1'), null)
		assert.equal(appRunIdFromIdempotencyKey('user-key'), null)
		assert.equal(appRunIdFromIdempotencyKey(null), null)
	})
})

describe('acceptAppRunReport', () => {
	const exp = () => Date.now() + 60_000
	it('records a report carrying a valid token for this user and package', async () => {
		const { env, runs } = fakeEnv()
		const token = await mintAppRunToken(masterKey, { uid: 'user_a', pkg: '@t/app', rid: 'app_9', exp: exp() })
		assert.equal(await acceptAppRunReport(env, props, { token, status: 500, error: null, logs: [] }), true)
		assert.equal(runs.length, 1)
		assert.equal(runs[0]?.idempotencyKey, appRunIdempotencyKey('app_9'))
		assert.deepEqual(runs[0]?.error, { name: 'app_http_error', message: 'The app responded 500.' })
	})

	it('refuses isolates not loaded as apps', async () => {
		const { env, runs } = fakeEnv()
		const token = await mintAppRunToken(masterKey, { uid: 'user_a', pkg: '@t/app', rid: 'app_9', exp: exp() })
		const { app: _app, ...packageProps } = props
		assert.equal(await acceptAppRunReport(env, packageProps, { token, status: 500, error: null, logs: [] }), false)
		assert.equal(runs.length, 0)
	})

	it('refuses a missing, forged, expired or foreign token', async () => {
		const { env, runs } = fakeEnv()
		const foreign = await mintAppRunToken(masterKey, { uid: 'user_b', pkg: '@t/app', rid: 'app_9', exp: exp() })
		const expired = await mintAppRunToken(masterKey, {
			uid: 'user_a',
			pkg: '@t/app',
			rid: 'app_9',
			exp: Date.now() - 1,
		})
		const forged = await mintAppRunToken(`${masterKey}x`, { uid: 'user_a', pkg: '@t/app', rid: 'app_9', exp: exp() })
		for (const token of [undefined, 'nope', foreign, expired, forged]) {
			assert.equal(await acceptAppRunReport(env, props, { token, status: 500, error: null, logs: [] }), false)
		}
		assert.equal(runs.length, 0)
	})

	it('a repeated report for the same request records nothing new', async () => {
		const { env, runs } = fakeEnv()
		const token = await mintAppRunToken(masterKey, { uid: 'user_a', pkg: '@t/app', rid: 'app_9', exp: exp() })
		const report = { token, status: 500, error: { name: 'Error', message: 'x' }, logs: [] }
		await acceptAppRunReport(env, props, report)
		await acceptAppRunReport(env, props, report)
		assert.equal(runs.length, 1)
	})
})
