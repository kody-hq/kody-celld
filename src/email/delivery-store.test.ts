import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { failStaleQueuedDeliveries, recordDelivery } from './delivery-store.ts'

/** Just enough of Durable Object `SqlStorage` (exec -> toArray) for the store. */
function memoryStore() {
	const db = new DatabaseSync(':memory:')
	// The delivery columns of `email_messages` and `email_delivery_events` (src/cells/user-cell.ts).
	db.exec(`CREATE TABLE email_messages (
		id TEXT PRIMARY KEY, direction TEXT NOT NULL, provider TEXT NOT NULL, provider_message_id TEXT,
		delivery_status TEXT, created_at TEXT NOT NULL);
	CREATE TABLE email_delivery_events (
		id TEXT PRIMARY KEY, message_id TEXT NOT NULL, provider TEXT NOT NULL, event TEXT NOT NULL,
		status TEXT NOT NULL, detail TEXT, at TEXT NOT NULL)`)
	const sql = {
		exec(query: string, ...params: Array<string | number | null>) {
			const statement = db.prepare(query)
			if (/^\s*select/i.test(query)) return { toArray: () => statement.all(...params) }
			statement.run(...params)
			return { toArray: () => [] }
		},
	} as unknown as SqlStorage
	return {
		sql,
		queue(id: string, createdAt: Date, status = 'queued') {
			db.prepare(
				`INSERT INTO email_messages (id, direction, provider, provider_message_id, delivery_status, created_at) VALUES (?, 'outbound', 'bridge', ?, ?, ?)`,
			).run(id, `<${id}@bridge>`, status, createdAt.toISOString())
		},
		status(id: string) {
			return (
				db.prepare('SELECT delivery_status FROM email_messages WHERE id = ?').get(id) as { delivery_status: string }
			).delivery_status
		},
		events(id: string) {
			return db
				.prepare('SELECT event, status, detail FROM email_delivery_events WHERE message_id = ? ORDER BY rowid')
				.all(id)
				.map((row) => ({ ...row }))
		},
	}
}

const now = new Date('2026-10-29T12:00:00.000Z')
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

test('fails sends still queued past the timeout, with the fixed reason, and leaves the rest alone', () => {
	const store = memoryStore()
	store.queue('eml_stale', minutesAgo(15))
	store.queue('eml_fresh', minutesAgo(14))
	store.queue('eml_sent', minutesAgo(60), 'sent')

	assert.deepEqual(failStaleQueuedDeliveries(store.sql, now), ['eml_stale'])

	assert.equal(store.status('eml_stale'), 'failed')
	assert.deepEqual(store.events('eml_stale'), [
		{
			event: 'delivery_timeout',
			status: 'failed',
			detail: 'No delivery report from the outbound provider within 15 minutes of queueing.',
		},
	])
	assert.equal(store.status('eml_fresh'), 'queued')
	assert.equal(store.status('eml_sent'), 'sent')
	assert.deepEqual(failStaleQueuedDeliveries(store.sql, now), [], 'a failed send is not failed twice')
})

test('ignores a late bridge report for a send that already failed', () => {
	const store = memoryStore()
	store.queue('eml_late', minutesAgo(20))
	failStaleQueuedDeliveries(store.sql, now)

	const outcome = recordDelivery(
		store.sql,
		{ providerMessageId: '<eml_late@bridge>', provider: 'bridge', status: 'sent', event: 'sent' },
		now.toISOString(),
	)

	assert.deepEqual(outcome, { kind: 'ignored', id: 'eml_late' })
	assert.equal(store.status('eml_late'), 'failed')
	assert.equal(store.events('eml_late').length, 1)
})

test('records a bridge report that arrives in time', () => {
	const store = memoryStore()
	store.queue('eml_ok', minutesAgo(1))

	const outcome = recordDelivery(
		store.sql,
		{ providerMessageId: '<eml_ok@bridge>', provider: 'bridge', status: 'sent', event: 'sent', detail: '250 ok' },
		now.toISOString(),
	)

	assert.deepEqual(outcome, { kind: 'recorded', id: 'eml_ok' })
	assert.equal(store.status('eml_ok'), 'sent')
	assert.deepEqual(store.events('eml_ok'), [{ event: 'sent', status: 'sent', detail: '250 ok' }])
	assert.deepEqual(failStaleQueuedDeliveries(store.sql, now), [])
})
