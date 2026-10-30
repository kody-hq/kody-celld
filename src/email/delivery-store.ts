import { randomId } from '../lib/crypto.ts'

/** How long an outbound send may stay `queued` before Kody marks it `failed`. Well past the bridge's longest shutdown deadline (about 7 minutes at its maximum timeouts). */
export const queuedDeliveryTimeoutMs = 15 * 60_000
export const queuedDeliveryTimeoutEvent = 'delivery_timeout'
export const queuedDeliveryTimeoutDetail =
	'No delivery report from the outbound provider within 15 minutes of queueing.'

export type DeliveryUpdate = {
	id?: string | undefined
	providerMessageId?: string | undefined
	provider: string
	status: string
	event: string
	detail?: string | null | undefined
	at?: string | undefined
}

export type DeliveryOutcome =
	| { kind: 'recorded'; id: string }
	/** The message already ended `failed`; a later report cannot change that. */
	| { kind: 'ignored'; id: string }

/** Records one delivery event for an outbound message. `failed` is final. */
export function recordDelivery(sql: SqlStorage, input: DeliveryUpdate, now: string): DeliveryOutcome | null {
	if (input.id === undefined && input.providerMessageId === undefined) return null
	const row = (
		input.id
			? sql.exec('SELECT id, delivery_status FROM email_messages WHERE id = ?', input.id)
			: sql.exec(
					`SELECT id, delivery_status FROM email_messages WHERE provider = ? AND provider_message_id = ? AND direction = 'outbound'`,
					input.provider,
					input.providerMessageId,
				)
	).toArray()[0] as { id: string; delivery_status: string | null } | undefined
	if (!row) return null
	if (row.delivery_status === 'failed') return { kind: 'ignored', id: row.id }
	sql.exec('UPDATE email_messages SET delivery_status = ? WHERE id = ?', input.status, row.id)
	if (input.providerMessageId !== undefined) {
		sql.exec(
			'UPDATE email_messages SET provider_message_id = COALESCE(provider_message_id, ?) WHERE id = ?',
			input.providerMessageId,
			row.id,
		)
	}
	sql.exec(
		'INSERT INTO email_delivery_events (id, message_id, provider, event, status, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		randomId('evt'),
		row.id,
		input.provider,
		input.event,
		input.status,
		input.detail ?? null,
		input.at ?? now,
	)
	return { kind: 'recorded', id: row.id }
}

/** Fails outbound sends still `queued` past `queuedDeliveryTimeoutMs`; returns their ids. */
export function failStaleQueuedDeliveries(sql: SqlStorage, now: Date): Array<string> {
	const cutoff = new Date(now.getTime() - queuedDeliveryTimeoutMs).toISOString()
	const stale = sql
		.exec(
			`SELECT id, provider FROM email_messages WHERE delivery_status = 'queued' AND direction = 'outbound' AND created_at <= ?`,
			cutoff,
		)
		.toArray() as Array<{ id: string; provider: string }>
	return stale.map((message) => {
		recordDelivery(
			sql,
			{
				id: message.id,
				provider: message.provider,
				status: 'failed',
				event: queuedDeliveryTimeoutEvent,
				detail: queuedDeliveryTimeoutDetail,
			},
			now.toISOString(),
		)
		return message.id
	})
}
