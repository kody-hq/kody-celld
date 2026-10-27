import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAdminEmailHtmlPreviewDocument, emailHtmlPreviewSandbox } from '#client/email-html-preview.ts'
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
		assert.match(doc, /<base target="_blank">/)
		assert.match(doc, /<p>Hi<\/p>/)
	})

	it('keeps a full document and puts the head tags at its start', () => {
		const doc = buildAdminEmailHtmlPreviewDocument(
			'<!DOCTYPE html><html><head><title>t</title></head><body>x</body></html>',
		)
		assert.match(
			doc,
			/^<!DOCTYPE html><meta name="referrer" content="no-referrer"><base target="_blank"><html><head><title>/,
		)
	})

	it('opens every link in a new tab: drops per-link target and rel', () => {
		const doc = buildAdminEmailHtmlPreviewDocument(
			'<html><body><a href="https://a.example" target="_self" rel="opener">a</a></body></html>',
		)
		assert.match(doc, /^<meta name="referrer" content="no-referrer"><base target="_blank"><html><body>/)
		assert.match(doc, /<a href="https:\/\/a.example">a<\/a>/)
	})

	it('sandbox allows popups that escape it, nothing else', () => {
		const tokens = emailHtmlPreviewSandbox.split(/\s+/).sort()
		assert.deepEqual(tokens, ['allow-popups', 'allow-popups-to-escape-sandbox'])
	})

	it('normalizes links that comments try to hide from the scanner', () => {
		const commentBoundary = `<!-- <a title=' --> <a href="https://attacker.example" rel="opener" target="_blank">open</a> <!-- '> -->`
		const doc = buildAdminEmailHtmlPreviewDocument(commentBoundary)
		const body = doc.slice(doc.indexOf('<body>'))
		assert.match(body, /<!-- <a title=' --> <a href="https:\/\/attacker\.example">open<\/a> <!-- '> -->/)
		assert.equal(/\srel\s*=/i.test(body), false)
		assert.equal(/\starget\s*=/i.test(body), false)

		const doubleQuoted = `<!-- <a title=" --> <a href="https://attacker.example" rel='opener' target='_blank'>x</a> <!-- "> -->`
		const doubleDoc = buildAdminEmailHtmlPreviewDocument(doubleQuoted)
		assert.match(doubleDoc, /<a href="https:\/\/attacker\.example">x<\/a>/)
		assert.equal(/rel=['"]opener['"]/i.test(doubleDoc), false)

		const areaBoundary = `<!-- <area href="/" title=' --> <area href="https://attacker.example" rel="opener" target="_blank"> <!-- '> -->`
		const areaDoc = buildAdminEmailHtmlPreviewDocument(areaBoundary)
		assert.match(areaDoc, /<area href="https:\/\/attacker\.example">/)
		assert.equal(/\srel\s*=/i.test(areaDoc.slice(areaDoc.indexOf('<body>'))), false)

		const inAttribute = `<div title='<a href="https://x.example" rel="opener" target="_blank">'>keep</div><a href="https://y.example" rel="opener">y</a>`
		const attrDoc = buildAdminEmailHtmlPreviewDocument(inAttribute)
		assert.match(attrDoc, /<div title='<a href="https:\/\/x\.example" rel="opener" target="_blank">'>keep<\/div>/)
		assert.match(attrDoc, /<a href="https:\/\/y\.example">y<\/a>/)
	})

	it('closes comments the way HTML does and skips raw-text contents', () => {
		const empty = buildAdminEmailHtmlPreviewDocument(
			`<!--><a href="https://attacker.example" rel="opener" target="_blank">x</a>`,
		)
		assert.match(empty, /<a href="https:\/\/attacker\.example">x<\/a>/)
		assert.equal(/rel=["']opener["']/i.test(empty), false)

		const bang = buildAdminEmailHtmlPreviewDocument(`<!-- x --!><a href="https://attacker.example" rel="opener">z</a>`)
		assert.match(bang, /<a href="https:\/\/attacker\.example">z<\/a>/)

		const styled = buildAdminEmailHtmlPreviewDocument(
			`<style>a[title='</style><a href="https://attacker.example" rel="opener" target="_blank">x</a><style>']{}</style>`,
		)
		assert.match(styled, /<a href="https:\/\/attacker\.example">x<\/a>/)
		assert.equal(/rel=["']opener["']/i.test(styled), false)
	})
})
