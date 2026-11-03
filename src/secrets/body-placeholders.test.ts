import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { replaceBodyPlaceholders } from './body-placeholders.ts'

const bytes = (...parts: Array<string | Array<number>>) =>
	Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'utf8') : Buffer.from(part))))
const buffer = (value: Buffer) =>
	value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer

describe('replaceBodyPlaceholders', () => {
	it('keeps invalid UTF-8 bytes outside the placeholder span unchanged', () => {
		const binary = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0xc3]
		const body = bytes('--b\r\n', binary, '\r\n--b\r\nnote={{secret:token}}\r\n--b--')
		const out = replaceBodyPlaceholders(buffer(body), new Map([['{{secret:token}}', 'sêcret']]))
		assert.ok(out)
		assert.deepEqual(Buffer.from(out), bytes('--b\r\n', binary, '\r\n--b\r\nnote=sêcret\r\n--b--'))
	})

	it('returns null when no placeholder is present', () => {
		const body = bytes([0xff, 0xfe], 'partial {{secret: marker')
		assert.equal(replaceBodyPlaceholders(buffer(body), new Map([['{{secret:token}}', 'x']])), null)
		assert.equal(replaceBodyPlaceholders(buffer(body), new Map()), null)
	})

	it('replaces every occurrence, including at the start and end', () => {
		const body = bytes('{{secret:a}}-{{secret:b}}-{{secret:a}}')
		const out = replaceBodyPlaceholders(
			buffer(body),
			new Map([
				['{{secret:a}}', '1'],
				['{{secret:b}}', '22'],
			]),
		)
		assert.equal(Buffer.from(out!).toString(), '1-22-1')
	})

	it('never rescans an inserted value', () => {
		const out = replaceBodyPlaceholders(
			buffer(bytes('{{secret:a}}')),
			new Map([
				['{{secret:a}}', '{{secret:b}}'],
				['{{secret:b}}', 'leaked'],
			]),
		)
		assert.equal(Buffer.from(out!).toString(), '{{secret:b}}')
	})

	it('prefers the longer placeholder that starts at the same byte', () => {
		const placeholder = '{{secret-basic:user:pass}}'
		const out = replaceBodyPlaceholders(
			buffer(bytes(`auth=Basic ${placeholder}&raw=${placeholder}`)),
			new Map([
				[`Basic ${placeholder}`, 'Basic dXNlcjpwYXNz'],
				[placeholder, 'dXNlcjpwYXNz'],
			]),
		)
		assert.equal(Buffer.from(out!).toString(), 'auth=Basic dXNlcjpwYXNz&raw=dXNlcjpwYXNz')
	})
})
