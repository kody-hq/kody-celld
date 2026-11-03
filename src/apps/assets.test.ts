import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { isAssetPath, serveAppAsset } from './assets.ts'

/** Every byte value after the PNG signature, so any text round trip would corrupt it. */
const pngBytes = Uint8Array.from([
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
	...Array.from({ length: 256 }, (_, i) => i),
])
const files: Record<string, Uint8Array> = {
	'public/styles.css': new TextEncoder().encode('body{}'),
	'public/img/logo.svg': new TextEncoder().encode('<svg/>'),
	'public/data.bin': Uint8Array.from([0, 1, 2]),
	'public/logo.png': pngBytes,
	'public/font.woff2': Uint8Array.from([0x77, 0x4f, 0x46, 0x32]),
	'public/app.wasm': Uint8Array.from([0x00, 0x61, 0x73, 0x6d]),
	'public/favicon.ico': Uint8Array.from([0, 0, 1, 0]),
	'public/notes.yaml': new TextEncoder().encode('a: 1'),
	'secret.ts': new TextEncoder().encode('nope'),
}
const loaded: Array<string> = []
const loadFile = async (path: string) => {
	loaded.push(path)
	return files[path] ?? null
}
const get = (restPath: string, init: RequestInit = {}) =>
	serveAppAsset({
		request: new Request(`https://a.example${restPath}`, init),
		restPath,
		loadFile,
		assetsDir: 'public',
	})

describe('isAssetPath', () => {
	it('matches /_assets and below only', () => {
		assert.equal(isAssetPath('/_assets/x.css'), true)
		assert.equal(isAssetPath('/_assets'), true)
		assert.equal(isAssetPath('/_assetsx'), false)
		assert.equal(isAssetPath('/x/_assets/y'), false)
	})
})

describe('serveAppAsset', () => {
	it('serves a file with type, etag and cache headers', async () => {
		const res = await get('/_assets/styles.css')
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8')
		assert.equal(res.headers.get('cache-control'), 'private, max-age=300')
		assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
		assert.match(res.headers.get('etag') ?? '', /^"[0-9a-f]{64}"$/)
		assert.equal(await res.text(), 'body{}')
	})
	it('answers 304 for a matching If-None-Match', async () => {
		const etag = (await get('/_assets/styles.css')).headers.get('etag') ?? ''
		const res = await get('/_assets/styles.css', { headers: { 'if-none-match': etag } })
		assert.equal(res.status, 304)
	})
	it('honours If-None-Match lists, weak validators and *', async () => {
		const etag = (await get('/_assets/styles.css')).headers.get('etag') ?? ''
		for (const header of [`"other", ${etag}`, `W/${etag}`, ` W/${etag} , "x"`, '*']) {
			const res = await get('/_assets/styles.css', { headers: { 'if-none-match': header } })
			assert.equal(res.status, 304, header)
		}
		const miss = await get('/_assets/styles.css', { headers: { 'if-none-match': '"nope", W/"also-no"' } })
		assert.equal(miss.status, 200)
	})
	it('serves nested files and HEAD without a body', async () => {
		assert.equal((await get('/_assets/img/logo.svg')).headers.get('content-type'), 'image/svg+xml; charset=utf-8')
		const head = await get('/_assets/styles.css', { method: 'HEAD' })
		assert.equal(head.status, 200)
		assert.equal(await head.text(), '')
	})
	it('serves binary assets byte-identical with their content type and a SHA-256 etag of the bytes', async () => {
		const res = await get('/_assets/logo.png')
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'image/png')
		assert.equal(res.headers.get('content-length'), String(pngBytes.byteLength))
		assert.equal(res.headers.get('etag'), `"${createHash('sha256').update(pngBytes).digest('hex')}"`)
		assert.deepEqual(new Uint8Array(await res.arrayBuffer()), pngBytes)
		const types = {
			'/_assets/font.woff2': 'font/woff2',
			'/_assets/app.wasm': 'application/wasm',
			'/_assets/favicon.ico': 'image/x-icon',
		}
		for (const [path, type] of Object.entries(types)) {
			const asset = await get(path)
			assert.equal(asset.headers.get('content-type'), type, path)
			assert.deepEqual(new Uint8Array(await asset.arrayBuffer()), files[`public${path.slice('/_assets'.length)}`])
		}
	})
	it('falls back to application/octet-stream for unknown extensions, as hosted does', async () => {
		assert.equal((await get('/_assets/data.bin')).headers.get('content-type'), 'application/octet-stream')
		assert.equal((await get('/_assets/notes.yaml')).headers.get('content-type'), 'application/octet-stream')
	})
	it('refuses escapes, missing files, __version.json, other methods, and apps without assets', async () => {
		for (const path of [
			'/_assets/../secret.ts',
			'/_assets/%2e%2e/secret.ts',
			'/_assets/%00secret.ts',
			'/_assets/nope.css',
			'/_assets/',
			'/_assets/__version.json',
		]) {
			assert.equal((await get(path)).status, 404, path)
		}
		assert.equal((await get('/_assets/styles.css', { method: 'POST', body: 'x' })).status, 405)
		loaded.length = 0
		const none = await serveAppAsset({
			request: new Request('https://a.example/_assets/styles.css'),
			restPath: '/_assets/styles.css',
			loadFile,
			assetsDir: null,
		})
		assert.equal(none.status, 404)
		assert.deepEqual(loaded, [])
	})
})
