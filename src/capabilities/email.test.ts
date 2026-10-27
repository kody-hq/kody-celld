import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { CapabilityContext } from './define.ts'
import { emailAttachmentGet } from './email.ts'

it('allows emailAttachmentGet to look up an attachment without a message id', async () => {
	const calls: Array<unknown> = []
	const context = {
		env: { KODY_EMAIL_DOMAIN: 'example.test' },
		userCell: {
			emailAttachmentGet: async (args: unknown) => {
				calls.push(args)
				return {
					id: 'att-1',
					messageId: 'msg-1',
					filename: 'note.txt',
					contentType: 'text/plain',
					contentId: null,
					disposition: 'attachment',
					size: 4,
					contentBase64: 'bm90ZQ==',
				}
			},
		},
	} as unknown as CapabilityContext
	const result = await emailAttachmentGet.handler({ attachmentId: 'att-1' }, context)
	assert.deepEqual(emailAttachmentGet.inputSchema.required, ['attachmentId'])
	assert.deepEqual(calls, [{ attachmentId: 'att-1' }])
	assert.deepEqual(result, {
		id: 'att-1',
		messageId: 'msg-1',
		filename: 'note.txt',
		contentType: 'text/plain',
		contentId: null,
		disposition: 'attachment',
		size: 4,
		contentBase64: 'bm90ZQ==',
	})
})
