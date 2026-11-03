// `/_assets/*` for package apps: files under `kody.app.assets`, answered by the
// host before the app's fetch handler runs. Text and binary files (#85) are
// served as their bytes.
import { bytesToHex } from '../lib/crypto.ts'

// Hosted's table and fallback, verbatim
// (kody: packages/worker/src/package-runtime/package-app-assets-directory.ts).
const assetContentTypesByExtension: Record<string, string> = {
	avif: 'image/avif',
	css: 'text/css; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	gif: 'image/gif',
	htm: 'text/html; charset=utf-8',
	html: 'text/html; charset=utf-8',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	js: 'text/javascript; charset=utf-8',
	json: 'application/json; charset=utf-8',
	map: 'application/json; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	oga: 'audio/ogg',
	ogg: 'audio/ogg',
	ogv: 'video/ogg',
	otf: 'font/otf',
	pdf: 'application/pdf',
	png: 'image/png',
	svg: 'image/svg+xml; charset=utf-8',
	ttf: 'font/ttf',
	txt: 'text/plain; charset=utf-8',
	wasm: 'application/wasm',
	wav: 'audio/wav',
	webm: 'video/webm',
	webmanifest: 'application/manifest+json; charset=utf-8',
	webp: 'image/webp',
	woff: 'font/woff',
	woff2: 'font/woff2',
	xml: 'application/xml; charset=utf-8',
}

export function inferPackageAppAssetContentType(path: string) {
	const name = path.split('/').pop() ?? ''
	const separator = name.lastIndexOf('.')
	const extension = separator <= 0 ? '' : name.slice(separator + 1).toLowerCase()
	return assetContentTypesByExtension[extension] ?? 'application/octet-stream'
}

export function isAssetPath(restPath: string) {
	return restPath === '/_assets' || restPath.startsWith('/_assets/')
}

function plain(status: number, message: string, extra: Record<string, string> = {}) {
	return new Response(message, {
		status,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
			...extra,
		},
	})
}

function relativeAssetPath(restPath: string): string | null {
	let decoded: string
	try {
		decoded = decodeURIComponent(restPath.slice('/_assets/'.length))
	} catch {
		return null
	}
	if (decoded === '' || decoded.includes('\\') || decoded.includes('\0')) return null
	const segments = decoded.split('/')
	if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
	return segments.join('/')
}

function matchesEtag(header: string | null, etag: string) {
	if (!header) return false
	return header.split(',').some((entry) => {
		const value = entry.trim()
		return value === '*' || value.replace(/^W\//, '') === etag
	})
}

export async function serveAppAsset(input: {
	request: Request
	restPath: string
	/** The bytes of one package file, or null when the package has no such file. */
	loadFile: (path: string) => Promise<Uint8Array | null>
	assetsDir: string | null
}): Promise<Response> {
	if (input.request.method !== 'GET' && input.request.method !== 'HEAD') {
		return plain(405, 'Assets accept GET and HEAD.', { allow: 'GET, HEAD' })
	}
	if (!input.assetsDir) return plain(404, 'Not found.')
	const relative = relativeAssetPath(input.restPath)
	// __version.json answers 404: this host does not build kody.app.client bundles.
	if (!relative || relative === '__version.json') return plain(404, 'Not found.')
	const bytes = await input.loadFile(`${input.assetsDir}/${relative}`)
	if (bytes === null) return plain(404, 'Not found.')
	const etag = `"${bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))}"`
	const headers = {
		'content-type': inferPackageAppAssetContentType(relative),
		'cache-control': 'private, max-age=300',
		etag,
		'x-content-type-options': 'nosniff',
	}
	if (matchesEtag(input.request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers })
	return new Response(input.request.method === 'HEAD' ? null : bytes, {
		status: 200,
		headers: { ...headers, 'content-length': String(bytes.byteLength) },
	})
}
