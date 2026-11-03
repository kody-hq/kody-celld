import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'
import {
	formatDocumentTimestamp,
	getDocumentTimestampLocale,
} from '../../start/document-locale.ts'
import { formatTimestamp } from '#client/format-timestamp.ts'

describe('document timestamp locale', () => {
	it('preserves the legacy server display for ISO, SQLite and invalid timestamps', () => {
		const locale = getDocumentTimestampLocale()
		for (const value of [
			'2025-01-02T12:00:00.000Z',
			'2025-01-02 12:00:00',
			'invalid',
		]) {
			assert.equal(
				formatDocumentTimestamp(value, locale),
				formatTimestamp(value),
			)
		}
	})
	it('keeps the serialized server display in processes with different locale and time zone defaults', () => {
		const locale = getDocumentTimestampLocale()
		const values = [
			'2025-01-02T12:00:00.000Z',
			'2025-01-02 23:00:00',
			'invalid',
		]
		const expected = values.map((value) =>
			formatDocumentTimestamp(value, locale),
		)
		const module = new URL('../../start/document-locale.ts', import.meta.url)
			.href
		const code = `import {formatDocumentTimestamp} from ${JSON.stringify(module)};
const locale = ${JSON.stringify(locale)};
console.log(JSON.stringify(${JSON.stringify(values)}.map(value => formatDocumentTimestamp(value, locale))));`
		for (const [lang, timeZone] of [
			['en_GB.UTF-8', 'America/Denver'],
			['ja_JP.UTF-8', 'Asia/Tokyo'],
		]) {
			const output = execFileSync(
				process.execPath,
				['--input-type=module', '-e', code],
				{
					env: { ...process.env, LANG: lang, TZ: timeZone },
					encoding: 'utf8',
				},
			)
			assert.deepEqual(JSON.parse(output), expected)
		}
	})
})
