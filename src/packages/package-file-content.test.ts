import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KodyError } from '../lib/errors.ts'
import { packageFileBytes, packageFileSize, packageTextFiles, readPackageFileInput } from './package-file-content.ts'

const isInvalidPackage = (pattern: RegExp) => (error: unknown) =>
	error instanceof KodyError && error.code === 'invalid_package' && pattern.test(error.message)

describe('readPackageFileInput', () => {
	it('keeps text as is and accepts { base64 } for a binary asset', () => {
		assert.equal(readPackageFileInput('main.js', 'export default 1'), 'export default 1')
		assert.deepEqual(readPackageFileInput('public/logo.png', { base64: 'iVBORw0KGgo=' }), { base64: 'iVBORw0KGgo=' })
		assert.deepEqual(readPackageFileInput('empty.bin', { base64: '' }), { base64: '' })
	})

	it('refuses malformed base64, extra keys and other shapes', () => {
		for (const base64 of ['iVBORw0KGgo', 'iVBO Rw0K', 'iVBORw0KGgo-', 'a===']) {
			assert.throws(() => readPackageFileInput('a.png', { base64 }), isInvalidPackage(/invalid base64/), base64)
		}
		for (const content of [1, null, ['x'], { base64: 'AA==', encoding: 'base64' }, { content: 'x' }]) {
			assert.throws(
				() => readPackageFileInput('a.png', content),
				isInvalidPackage(/must be a string, or \{ base64 \}/),
				JSON.stringify(content),
			)
		}
	})

	it('refuses binary content for modules, JSON, README.md and AGENTS.md', () => {
		for (const path of [
			'main.js',
			'lib/x.ts',
			'app.tsx',
			'package.json',
			'data/config.json',
			'README.md',
			'AGENTS.md',
		]) {
			assert.throws(() => readPackageFileInput(path, { base64: 'AA==' }), isInvalidPackage(/must be UTF-8 text/), path)
		}
	})
})

describe('package file bytes', () => {
	it('decodes binary files exactly and encodes text as UTF-8', () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
		const file = { base64: Buffer.from(bytes).toString('base64') }
		assert.deepEqual(packageFileBytes(file), bytes)
		assert.equal(packageFileSize(file), 256)
		assert.deepEqual(packageFileBytes('é'), Uint8Array.from([0xc3, 0xa9]))
		for (const length of [0, 1, 2, 3, 4]) {
			assert.equal(packageFileSize({ base64: Buffer.alloc(length).toString('base64') }), length)
		}
	})

	it('packageTextFiles leaves binary files out', () => {
		assert.deepEqual(packageTextFiles({ 'a.js': 'x', 'b.png': { base64: 'AA==' } }), { 'a.js': 'x' })
	})
})
