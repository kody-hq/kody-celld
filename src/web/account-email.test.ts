import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAdminEmailHtmlPreviewDocument } from '#client/email-html-preview.ts'
import type { EmailMessageRecord } from '../cells/user-cell.ts'
import { emailMessageDetailView, formatEmailAddress, readEmailBodyView, readEmailMessageId } from './account-email.ts'

function record(overrides: Partial<EmailMessageRecord> = {}): EmailMessageRecord {
	return {
		id: 'msg_1',
		direction: 'inbound',
		inboxAddress: 'daily@kody.local.test',
		from: { address: 'alice@sender.example', name: 'Alice' },
		to: [{ address: 'daily@kody.local.test', name: null }],
		cc: [{ address: 'bob@sender.example', name: 'Bob' }],
		replyTo: [],
		subject: 'GitHub daily',
		messageId: 'abc@sender.example',
		inReplyTo: null,
		references: [],
		text: '# GitHub daily\n\nThree things to do today.',
		html: '<h1>GitHub daily</h1><p>Three things to do today.</p>',
		headers: { 'x-mailer': 'smoke' },
		attachments: [
			{
				id: 'att_1',
				filename: 'notes.txt',
				contentType: 'text/plain',
				size: 42,
				contentId: null,
				disposition: 'attachment',
			},
		],
		classification: 'inbox',
		classificationReason: null,
		provider: 'generic',
		providerMessageId: null,
		deliveryStatus: null,
		sizeBytes: 2048,
		packageName: null,
		inReplyToMessageId: null,
		receivedAt: '2026-10-23T17:46:10.000Z',
		createdAt: '2026-10-23T17:46:10.000Z',
		...overrides,
	}
}

describe('formatEmailAddress', () => {
	it('shows the display name when there is one', () => {
		assert.equal(formatEmailAddress({ address: 'a@x.example', name: 'Alice' }), 'Alice <a@x.example>')
	})

	it('falls back to the bare address', () => {
		assert.equal(formatEmailAddress({ address: 'a@x.example', name: null }), 'a@x.example')
		assert.equal(formatEmailAddress({ address: 'a@x.example', name: '  ' }), 'a@x.example')
	})
})

describe('readEmailMessageId', () => {
	it('is null for the list', () => {
		assert.equal(readEmailMessageId(undefined), null)
		assert.equal(readEmailMessageId(''), null)
	})

	it('decodes the path segment', () => {
		assert.equal(readEmailMessageId('msg%201'), 'msg 1')
	})

	it('keeps a malformed segment so the page can say not found', () => {
		assert.equal(readEmailMessageId('%E0%A4%A'), '%E0%A4%A')
	})
})

describe('readEmailBodyView', () => {
	it('honors an explicit tab', () => {
		assert.equal(readEmailBodyView('text', { html: '<p>x</p>' }), 'text')
		assert.equal(readEmailBodyView('source', { html: null }), 'source')
		assert.equal(readEmailBodyView('html', { html: null }), 'html')
	})

	it('opens on HTML like hosted Kody, or text when there is no HTML part', () => {
		assert.equal(readEmailBodyView(null, { html: '<p>x</p>' }), 'html')
		assert.equal(readEmailBodyView(null, { html: null }), 'text')
		assert.equal(readEmailBodyView('bogus', { html: '' }), 'text')
		assert.equal(readEmailBodyView(null, null), 'text')
	})
})

describe('emailMessageDetailView', () => {
	it('carries the full bodies and the headers the page shows', () => {
		const view = emailMessageDetailView(record())
		assert.equal(view.subject, 'GitHub daily')
		assert.equal(view.from, 'Alice <alice@sender.example>')
		assert.deepEqual(view.to, ['daily@kody.local.test'])
		assert.deepEqual(view.cc, ['Bob <bob@sender.example>'])
		assert.deepEqual(view.replyTo, [])
		assert.equal(view.receivedAt, '2026-10-23T17:46:10.000Z')
		assert.equal(view.text, '# GitHub daily\n\nThree things to do today.')
		assert.equal(view.html, '<h1>GitHub daily</h1><p>Three things to do today.</p>')
		assert.deepEqual(view.attachments, [{ id: 'att_1', filename: 'notes.txt', contentType: 'text/plain', size: 42 }])
	})

	it('never copies raw headers or attachment bytes onto the page', () => {
		const view = emailMessageDetailView(
			record({
				attachments: [
					{
						id: 'att_2',
						filename: 'a.bin',
						contentType: 'application/octet-stream',
						size: 3,
						contentId: 'cid-1',
						disposition: 'inline',
						contentBase64: 'AAAA',
					} as EmailMessageRecord['attachments'][number],
				],
			}),
		)
		assert.equal('headers' in view, false)
		assert.deepEqual(Object.keys(view.attachments[0] ?? {}).sort(), ['contentType', 'filename', 'id', 'size'])
	})

	it('keeps a long body whole instead of the list snippet', () => {
		const text = 'line\n'.repeat(5000)
		assert.equal(emailMessageDetailView(record({ text })).text, text)
	})
})

describe('email HTML preview (verbatim from hosted Kody)', () => {
	it('strips scripts and wraps a fragment with no-referrer and new-tab links', () => {
		const doc = buildAdminEmailHtmlPreviewDocument('<p>Hi</p><script>alert(1)</script>')
		assert.equal(doc.includes('<script'), false)
		assert.match(doc, /<meta name="referrer" content="no-referrer">/)
		assert.match(doc, /<base target="_blank" rel="noopener noreferrer">/)
		assert.match(doc, /<p>Hi<\/p>/)
	})

	it('keeps a full document and injects the referrer policy into its head', () => {
		const doc = buildAdminEmailHtmlPreviewDocument(
			'<!DOCTYPE html><html><head><title>t</title></head><body>x</body></html>',
		)
		assert.match(doc, /^<!DOCTYPE html><html><head><meta name="referrer" content="no-referrer">/)
	})
})
