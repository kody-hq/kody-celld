import { deliverPackageEvent, stripUntrustedSubscriptionEnvelopeFields } from '../packages/package-events.ts'
import { canonicalJsonStringify } from '../lib/canonical-json.ts'
import { listJsonSchemaSubsetValueErrors } from '../lib/json-schema-subset.ts'
import { KodyError } from '../lib/errors.ts'
import { defineCapability, defineDomain, type CapabilityContext } from './define.ts'

export const maxPackageRuntimeInvokeDepth = 8
export const maxPackageEventPayloadBytes = 64 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePackageEventDispatchInput(rawInput: unknown) {
	const input = isRecord(rawInput) ? rawInput : {}
	const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
	if (!topic) throw new KodyError('invalid_input', 'events.dispatch requires a non-empty topic.')
	const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : ''
	if (!idempotencyKey) throw new KodyError('invalid_input', 'events.dispatch requires a non-empty idempotencyKey.')
	const payload = input.payload ?? {}
	if (!isRecord(payload)) {
		throw new KodyError('invalid_input', 'events.dispatch payload must be a JSON object when provided.')
	}
	return { topic, idempotencyKey, payload: stripUntrustedSubscriptionEnvelopeFields(payload) }
}

export const eventsDomain = defineDomain({
	name: 'events',
	description: 'Dispatch events from package runtimes to package subscribers.',
})

export const packageEventDispatch = defineCapability({
	domain: 'events',
	name: 'packageEventDispatch',
	description: 'Dispatch a declared package event to matching package subscribers.',
	tags: ['events', 'write'],
	keywords: ['events', 'dispatch', 'package event', 'subscriber'],
	inputSchema: { type: 'object' },
	outputSchema: {
		type: 'object',
		properties: {
			topic: { type: 'string' },
			source: { type: 'object' },
			idempotencyKey: { type: 'string' },
			status: { type: 'string', enum: ['delivered_inline'] },
		},
	},
	async handler(args: Record<string, unknown>, ctx: CapabilityContext) {
		if (!ctx.fromRuntime || !ctx.packageName) {
			throw new KodyError('events_unavailable', 'events.dispatch requires a package runtime context.')
		}
		if (ctx.eventDepth >= maxPackageRuntimeInvokeDepth) {
			throw new KodyError(
				'event_depth_exceeded',
				`events.dispatch exceeded the maximum nested invocation depth (${maxPackageRuntimeInvokeDepth}).`,
			)
		}
		const input = parsePackageEventDispatchInput(args)
		const pkg = await ctx.userCell.packageGet(ctx.packageName)
		const declaredEvent = pkg?.manifest.emits.find((event) => event.topic === input.topic)
		if (!declaredEvent) {
			throw new KodyError(
				'event_not_declared',
				`Package "${ctx.packageName}" does not declare emitted event "${input.topic}" in package.json#kody.emits.`,
			)
		}
		if (declaredEvent.payloadSchema) {
			const errors = listJsonSchemaSubsetValueErrors(declaredEvent.payloadSchema, input.payload)
			if (errors.length > 0) {
				throw new KodyError(
					'invalid_input',
					`events.dispatch payload does not match the declared payloadSchema for "${input.topic}":\n${errors.join('\n')}`,
				)
			}
		}
		const payloadBytes = new TextEncoder().encode(canonicalJsonStringify(input.payload) ?? 'null').byteLength
		if (payloadBytes > maxPackageEventPayloadBytes) {
			throw new KodyError(
				'payload_too_large',
				`events.dispatch payload is ${payloadBytes} bytes; the maximum is ${maxPackageEventPayloadBytes} bytes. Store large data in packageStorage() and emit a reference instead.`,
			)
		}
		const delivery = deliverPackageEvent({
			env: ctx.env,
			exports: ctx.exports,
			userCell: ctx.userCell,
			user: ctx.user,
			sourcePackageId: ctx.packageName,
			topic: input.topic,
			idempotencyKey: input.idempotencyKey,
			payload: input.payload,
			eventDepth: ctx.eventDepth,
		})
		if (ctx.waitUntil) {
			ctx.waitUntil(
				delivery.catch((error) => {
					console.error(`package event ${input.topic} delivery failed:`, error)
				}),
			)
		} else {
			await delivery
		}
		return {
			topic: input.topic,
			source: { type: 'package', packageId: ctx.packageName, kodyId: ctx.packageName },
			idempotencyKey: input.idempotencyKey,
			status: 'delivered_inline' as const,
		}
	},
})

export const eventCapabilities = [packageEventDispatch]
