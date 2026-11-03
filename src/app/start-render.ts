import type { StartDocumentData } from '../../start/request-context.ts'
import { getDocumentTimestampLocale } from '../../start/document-locale.ts'
import type { RenderPageOptions } from './render.tsx'
import { KODY_CELLD_VERSION } from '../env.ts'
import {
	contentSecurityPolicyWithNonce,
	pageResponseHeaders,
} from './security-headers.ts'
import { openDocumentStream } from './ssr-document-stream.ts'

export async function renderStartDocument(
	request: Request,
	options: RenderPageOptions,
): Promise<Response> {
	const nonce = crypto.randomUUID().replaceAll('-', '')
	const document: StartDocumentData = {
		title: `${options.title} · Kody`,
		timestampLocale: getDocumentTimestampLocale(),
		pathname: options.pathname,
		data: options.data,
		session: options.session ?? null,
		flash: options.flash ?? null,
		version: KODY_CELLD_VERSION,
	}
	const { default: server } = await import('#start-server')
	const response = await server.fetch(request, { context: { nonce, document } })
	const headers = new Headers(response.headers)
	for (const [name, value] of Object.entries(
		pageResponseHeaders(options.headers),
	)) {
		headers.set(name, value)
	}
	headers.set('content-security-policy', contentSecurityPolicyWithNonce(nonce))
	const body = response.body
		? await openDocumentStream(response.body, { prependDoctype: false })
		: null
	return new Response(body, {
		status: response.ok ? (options.status ?? response.status) : response.status,
		headers,
	})
}
