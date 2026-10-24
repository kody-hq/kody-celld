import type { UserCell } from '../cells/user-cell.ts'
import type { Env } from '../env.ts'
import { executeRun, runRecordMaxIdempotencyKeyLength } from '../execute/engine.ts'
import { canonicalJsonStringify } from '../lib/canonical-json.ts'
import { sha256Hex } from '../lib/crypto.ts'

const untrustedSubscriptionEnvelopeFields = ['synthetic', 'replay_of'] as const

export function stripUntrustedSubscriptionEnvelopeFields<T extends Record<string, unknown>>(params: T): T {
	const stripped = { ...params }
	for (const field of untrustedSubscriptionEnvelopeFields) delete stripped[field]
	return stripped as T
}

export function packageEventFiltersMatchPayload(input: {
	filters: Record<string, unknown> | null | undefined
	payload: Record<string, unknown>
}) {
	if (!input.filters) return true
	return Object.entries(input.filters).every(
		([key, expected]) =>
			key in input.payload && canonicalJsonStringify(input.payload[key]) === canonicalJsonStringify(expected),
	)
}

export async function buildPackageEventSubscriptionIdempotencyKey(input: {
	sourcePackageId: string
	subscriberPackageId: string
	topic: string
	idempotencyKey: string
}) {
	const digest = await sha256Hex(canonicalJsonStringify(input) ?? 'null')
	const key = `pkgevent:${input.sourcePackageId}:${input.subscriberPackageId}:${input.topic}:${digest.slice(0, 24)}`
	return key.length <= runRecordMaxIdempotencyKeyLength ? key : `pkgevent:${digest}`
}

export function buildPackageEventEnvelope(input: {
	topic: string
	sourcePackageId: string
	idempotencyKey: string
	payload: Record<string, unknown>
}) {
	return stripUntrustedSubscriptionEnvelopeFields({
		event: input.topic,
		source: { type: 'package', package_id: input.sourcePackageId, kody_id: input.sourcePackageId },
		idempotency_key: input.idempotencyKey,
		payload: stripUntrustedSubscriptionEnvelopeFields(input.payload),
	})
}

export async function deliverPackageEvent(input: {
	env: Env
	exports: ExecutionContext['exports']
	userCell: DurableObjectStub<UserCell>
	user: { id: string; email: string }
	sourcePackageId: string
	topic: string
	idempotencyKey: string
	payload: Record<string, unknown>
	eventDepth: number
}) {
	const subscriptions = await input.userCell.subscriptionList({ topic: input.topic })
	const envelope = buildPackageEventEnvelope(input)
	for (const subscription of subscriptions) {
		if (!packageEventFiltersMatchPayload({ filters: subscription.filters, payload: input.payload })) continue
		try {
			await executeRun(input.env, input.exports, {
				kind: 'subscription',
				user: input.user,
				entry: {
					kind: 'package',
					packageName: subscription.packageName,
					entryPath: subscription.handler,
				},
				params: envelope,
				trigger: `subscription:${input.topic}`,
				idempotencyKey: await buildPackageEventSubscriptionIdempotencyKey({
					sourcePackageId: input.sourcePackageId,
					subscriberPackageId: subscription.packageName,
					topic: input.topic,
					idempotencyKey: input.idempotencyKey,
				}),
				eventDepth: input.eventDepth + 1,
			})
		} catch (error) {
			console.error(`package subscription ${subscription.packageName} (${input.topic}) failed:`, error)
		}
	}
}
