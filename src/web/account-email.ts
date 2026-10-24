import type { EmailAddress, EmailMessageRecord } from '../cells/user-cell.ts'
import type { EmailBodyView, EmailMessageDetailView } from '#universal/loader-data.ts'

/** `Name <address>`, or the bare address when the sender gave no name. */
export function formatEmailAddress(address: EmailAddress): string {
	const name = address.name?.trim()
	return name ? `${name} <${address.address}>` : address.address
}

/**
 * The message id in `/account/inbox/:messageId`, or null for the list. A
 * segment that is not valid percent-encoding is kept as typed so the page
 * can say the message was not found instead of failing the request.
 */
export function readEmailMessageId(segment: string | undefined): string | null {
	if (!segment) return null
	try {
		return decodeURIComponent(segment) || null
	} catch {
		return segment
	}
}

/**
 * `?body=` picks the tab. Without one the message opens on its HTML body,
 * like hosted Kody, and falls back to text when it has no HTML part.
 */
export function readEmailBodyView(raw: string | null, message: { html: string | null } | null): EmailBodyView {
	if (raw === 'html' || raw === 'text' || raw === 'source') return raw
	return message?.html ? 'html' : 'text'
}

/** Page payload for one message: addresses flattened, bodies as stored. */
export function emailMessageDetailView(message: EmailMessageRecord): EmailMessageDetailView {
	return {
		id: message.id,
		direction: message.direction,
		subject: message.subject,
		from: formatEmailAddress(message.from),
		to: message.to.map(formatEmailAddress),
		cc: message.cc.map(formatEmailAddress),
		replyTo: message.replyTo.map(formatEmailAddress),
		receivedAt: message.receivedAt,
		inboxAddress: message.inboxAddress,
		classification: message.classification,
		classificationReason: message.classificationReason,
		deliveryStatus: message.deliveryStatus,
		sizeBytes: message.sizeBytes,
		text: message.text,
		html: message.html,
		attachments: message.attachments.map((attachment) => ({
			id: attachment.id,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
		})),
	}
}
