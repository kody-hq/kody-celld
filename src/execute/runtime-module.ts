// Source of the host-owned `kody:runtime` module that is injected into every
// Worker Loader isolate. It talks to the host through the `KODY` service
// binding (RuntimeHost RPC). Kept as a string so the runtime never needs a
// bundler at execution time.
export const RUNTIME_MODULE_SOURCE = `
import { AsyncLocalStorage } from 'node:async_hooks'

const __als = new AsyncLocalStorage()
let __env = null

export function __init(env) {
	__env = env
}

export function __run(context, fn) {
	return __als.run(context, fn)
}

export function __current() {
	return __als.getStore() ?? null
}

function __callContext() {
	const store = __current()
	return store ? { runId: store.runId, packageName: store.packageName } : null
}

function host() {
	if (!__env) throw new Error('kody:runtime is not initialized for this isolate.')
	return __env.KODY
}

const credentialDetailsMarker = '\\n__kody_credential_error_details__:'

function credentialError(code, message, details = {}) {
	const error = new Error(message)
	error.name = 'CredentialError'
	error.code = code
	if (Array.isArray(details.options)) error.options = details.options
	if (Array.isArray(details.retryWith)) error.retryWith = details.retryWith
	if (typeof details.createUrl === 'string') error.createUrl = details.createUrl
	return error
}

function credentialErrorFromThrown(error) {
	const message = String(error?.message ?? error ?? '')
	const match = /^([a-z_]+): /.exec(message)
	if (!match) return error
	const detailsMatch = /\\n__kody_credential_error_details__:(\\{.*\\})$/.exec(message)
	let details = {}
	if (detailsMatch) {
		try {
			details = JSON.parse(detailsMatch[1])
		} catch {}
	}
	const visibleMessage = detailsMatch ? message.slice(0, detailsMatch.index) : message
	return credentialError(match[1], visibleMessage.slice(match[0].length), details)
}

async function credentialOpen(args) {
	try {
		return await host().credentialOpen(args, __callContext())
	} catch (error) {
		throw credentialErrorFromThrown(error)
	}
}

function credentialHostAllowed(hosts, hostName) {
	const target = String(hostName).toLowerCase()
	return hosts.some((entry) => {
		const approved = String(entry).trim().toLowerCase()
		if (!approved.startsWith('*.')) return approved === target
		const suffix = approved.slice(1)
		return target.endsWith(suffix) && target.length > suffix.length
	})
}

function credentialFirstExactHost(hosts) {
	return hosts.find((hostName) => !String(hostName).startsWith('*.')) ?? null
}

function credentialDenied(message) {
	return credentialError('credential_denied', message)
}

function credentialResolveUrl(input, hosts) {
	const raw = input instanceof Request ? input.url : String(input)
	try {
		const url = /^[a-z][a-z0-9+.-]*:/i.test(raw)
			? new URL(raw)
			: new URL(raw, 'https://' + credentialFirstExactHost(hosts))
		if (url.protocol !== 'https:' || !credentialHostAllowed(hosts, url.hostname)) {
			throw credentialDenied('Credential requests must use HTTPS on an approved host.')
		}
		return url.toString()
	} catch (error) {
		if (error?.name === 'CredentialError') throw error
		throw credentialDenied('Credential request URL must be HTTPS on an approved host.')
	}
}

function credentialPlaceholder(opened) {
	if (opened.kind === 'secret') {
		const scope = '|scope=' + (opened.scope === 'package' ? 'package' : 'user')
		return 'Bearer {{secret:' + opened.name + scope + '}}'
	}
	return 'Bearer {{integration-token:' + opened.name + '}}'
}

function credentialRedirected(response) {
	Object.defineProperty(response, 'redirected', { value: true })
	return response
}

function credentialFetch(opened) {
	return async (input, init) => {
		const redirectMode = init?.redirect ?? (input instanceof Request ? input.redirect : 'follow')
		const url = credentialResolveUrl(input, opened.hosts)
		const source = input instanceof Request ? new Request(input, init) : new Request(url, init)
		let headers = new Headers(source.headers)
		headers.set('authorization', credentialPlaceholder(opened))
		let request = new Request(url, source)
		request = new Request(request, { headers, redirect: 'manual' })
		for (let hop = 0; ; hop += 1) {
			const replay = request.body ? request.clone() : request
			const response = await globalThis.fetch(request)
			if (![301, 302, 303, 307, 308].includes(response.status) || redirectMode === 'manual') {
				return hop > 0 ? credentialRedirected(response) : response
			}
			if (redirectMode === 'error') {
				await response.body?.cancel()
				throw new TypeError('The response redirected and redirect is "error".')
			}
			const location = response.headers.get('location')
			if (!location) return hop > 0 ? credentialRedirected(response) : response
			if (hop >= 20) {
				await response.body?.cancel()
				throw new TypeError('Too many redirects.')
			}
			await response.body?.cancel()
			const next = new URL(location, response.url || request.url)
			const current = new URL(request.url)
			const rewrite =
				(response.status === 303 && request.method !== 'HEAD') ||
				((response.status === 301 || response.status === 302) && request.method === 'POST')
			headers = new Headers(replay.headers)
			if (next.origin !== current.origin) {
				headers.delete('cookie')
				headers.delete('proxy-authorization')
			}
			if (
				next.protocol !== 'https:' ||
				!credentialHostAllowed(opened.hosts, next.hostname) ||
				next.origin !== current.origin
			) {
				headers.delete('authorization')
			}
			if (rewrite) {
				headers.delete('content-type')
				headers.delete('content-length')
			}
			request = new Request(next, {
				method: rewrite ? 'GET' : replay.method,
				headers,
				body: rewrite ? null : replay.body,
				...(rewrite || !replay.body ? {} : { duplex: 'half' }),
				redirect: 'manual',
			})
		}
	}
}

function credentialClient(opened) {
	if (!['secret', 'oauth', 'mcp'].includes(opened.kind)) {
		throw credentialError('credential_unsupported', 'This credential kind is not supported on celld yet.')
	}
	const client = { name: opened.name, scope: opened.scope, kind: opened.kind, hosts: [...opened.hosts] }
	if (opened.kind === 'mcp') {
		client.callTool = async (tool, args) => {
			try {
				return await host().mcpCall(opened.name, tool, args === undefined ? {} : args, __callContext())
			} catch (error) {
				throw credentialErrorFromThrown(error)
			}
		}
	} else {
		client.fetch = credentialFetch(opened)
	}
	return Object.freeze(client)
}

const credential = async (key) => credentialClient(await credentialOpen({ key }))
credential.named = async (name, options) =>
	credentialClient(await credentialOpen({ name, scope: options?.scope ?? null }))

export { credential }
export async function credentials(key) {
	const opened = await credentialOpen({ key, all: true })
	return (Array.isArray(opened) ? opened : []).map(credentialClient)
}

const secretNamePattern = /^[a-zA-Z0-9._-]+$/

function assertSecretName(value, label) {
	if (typeof value !== 'string' || !secretNamePattern.test(value)) {
		throw new TypeError(label + ' must be a secret name (letters, digits, ".", "_", "-").')
	}
	return value
}

/**
 * Returns a fetch that sends \`Authorization: Bearer {{integration-token:<name>}}\`.
 * The placeholder is swapped for the real access token by the host gateway,
 * which also enforces the connection's host allowlist and refreshes expired
 * tokens; sandbox code never sees a raw token.
 */
export function createAuthenticatedFetch(integrationName, options = {}) {
	const name = assertSecretName(integrationName, 'createAuthenticatedFetch(name)')
	const headerName = typeof options.headerName === 'string' && options.headerName ? options.headerName : 'authorization'
	const scheme = options.scheme === undefined ? 'Bearer' : options.scheme
	const placeholder = '{{integration-token:' + name + '}}'
	const headerValue = scheme ? scheme + ' ' + placeholder : placeholder
	return async (input, init) => {
		const request = new Request(input, init)
		if (!request.headers.has(headerName)) request.headers.set(headerName, headerValue)
		return fetch(request)
	}
}

/** Client-credentials connections are ordinary integrations; the grant type only changes how the host refreshes. */
export const oauthClientCredentials = createAuthenticatedFetch

export const secretHeaders = {
	basic({ usernameSecret, passwordSecret, scope } = {}) {
		const username = assertSecretName(usernameSecret, 'secretHeaders.basic({ usernameSecret })')
		const password = assertSecretName(passwordSecret, 'secretHeaders.basic({ passwordSecret })')
		const suffix = scope === 'package' || scope === 'user' ? '|scope=' + scope : ''
		return { authorization: '{{secret-basic:username=' + username + ',password=' + password + suffix + '}}' }
	},
	bearer(secretName, scope) {
		const name = assertSecretName(secretName, 'secretHeaders.bearer(name)')
		const suffix = scope === 'package' || scope === 'user' ? '|scope=' + scope : ''
		return { authorization: 'Bearer {{secret:' + name + suffix + '}}' }
	},
}

// kody.mcp["server"].tool(input): user-added remote MCP servers, called host-side.
const __mcp = new Proxy(Object.create(null), {
	get(_target, server) {
		if (typeof server !== 'string' || server === 'then' || server === 'toJSON') return undefined
		return new Proxy(Object.create(null), {
			get(_t, tool) {
				if (typeof tool !== 'string' || tool === 'then' || tool === 'toJSON') return undefined
				return async (args = {}) => host().mcpCall(server, tool, args ?? {}, __callContext())
			},
		})
	},
})

export const kody = new Proxy(Object.create(null), {
	get(_target, name) {
		if (typeof name !== 'string' || name === 'then' || name === 'toJSON') return undefined
		if (name === 'mcp') return __mcp
		return async (args = {}) => host().capability(name, args ?? {}, __callContext())
	},
	has() {
		return true
	},
})

export let packageContext = null

export function __setPackageContext(context) {
	packageContext = context
}

// Package modules are stamped at graph-build time: packageStorage() becomes
// packageStorage('<their package>'), so provenance follows the declaring
// module even when it is imported from ad hoc code or another package.
export function packageStorage(__declaringPackage) {
	const context = __current()
	const packageName = typeof __declaringPackage === 'string' && __declaringPackage !== '' ? __declaringPackage : context?.packageName
	if (typeof packageName !== 'string' || packageName === '') {
		throw new Error(
			'packageStorage() requires package provenance: this module was not run from a saved package. ' +
				'Ad hoc execute has no scratch SQLite helper. Save a package and call its export, ' +
				"or statically import the owning package's export (kody:@scope/package/export).",
		)
	}
	return {
		id: 'package-storage:' + packageName,
		get: (key) => host().storageGet(packageName, key),
		set: (key, value) => host().storageSet(packageName, key, value),
		delete: (key) => host().storageDelete(packageName, key),
		list: (options) => host().storageList(packageName, options ?? {}),
		clear: () => host().storageClear(packageName),
		sql: (query, ...params) => host().storageSql(packageName, query, params),
	}
}

export const packageSecrets = {
	async list() {
		const result = await host().capability('secretList', {}, __callContext())
		return result.secrets
	},
}

const emailTriggerNames = [
	'subscription:email.message.received',
	'subscription:email.message.quarantined',
]
const emailRuntimeUnboundMessage =
	'email is only available in email.message.received and email.message.quarantined subscription handlers.'

function assertEmailRuntimeBound() {
	const trigger = __current()?.trigger
	if (emailTriggerNames.includes(trigger)) return
	const error = new Error(emailRuntimeUnboundMessage)
	error.name = 'RuntimeHelperUnbound'
	error.code = 'runtime_helper_unbound'
	throw error
}

function emailMessageId(value, method, resource) {
	const id = typeof value === 'string' ? value.trim() : ''
	if (!id) throw new Error(method + ' requires a non-empty ' + resource + ' id.')
	return id
}

export const email = {
	async getMessage(messageId) {
		assertEmailRuntimeBound()
		const id = emailMessageId(messageId, 'email.getMessage', 'message')
		const message = await host().capability('emailMessageGet', { id }, __callContext())
		return {
			id: message.id,
			direction: message.direction,
			inbox_id: message.inboxAddress,
			thread_id: null,
			from_address: message.from.address,
			envelope_from: null,
			to_addresses: message.to.map((address) => address.address),
			cc_addresses: message.cc.map((address) => address.address),
			bcc_addresses: [],
			reply_to_addresses: message.replyTo.map((address) => address.address),
			subject: message.subject,
			message_id_header: message.messageId,
			in_reply_to_header: message.inReplyTo,
			references: message.references,
			headers: message.headers,
			auth_results: null,
			text_body: message.text,
			html_body: message.html,
			raw_size: message.sizeBytes,
			processing_status: null,
			provider_message_id: message.providerMessageId,
			delivery_status: message.deliveryStatus,
			delivery_status_at: null,
			error: null,
			received_at: message.receivedAt,
			sent_at: null,
			created_at: message.createdAt,
			updated_at: null,
			attachments: message.attachments.map((attachment) => ({
				id: attachment.id,
				filename: attachment.filename,
				content_type: attachment.contentType,
				content_id: attachment.contentId,
				disposition: attachment.disposition,
				size: attachment.size,
				storage_kind: null,
				storage_key: null,
				created_at: null,
			})),
		}
	},
	async getAttachment(attachmentId) {
		assertEmailRuntimeBound()
		const id = emailMessageId(attachmentId, 'email.getAttachment', 'attachment')
		const attachment = await host().capability('emailAttachmentGet', { attachmentId: id }, __callContext())
		return {
			id: attachment.id,
			message_id: attachment.messageId,
			filename: attachment.filename,
			content_type: attachment.contentType,
			content_id: attachment.contentId,
			disposition: attachment.disposition,
			size: attachment.size,
			content_base64: attachment.contentBase64,
		}
	},
	async reply(input) {
		assertEmailRuntimeBound()
		const request = input && typeof input === 'object' ? input : {}
		return host().capability(
			'emailReply',
			{
				id: request.message_id ?? request.id,
				...(request.text === undefined ? {} : { text: request.text }),
				...(request.html === undefined ? {} : { html: request.html }),
				...(request.subject === undefined ? {} : { subject: request.subject }),
				...(request.attachments === undefined ? {} : { attachments: request.attachments }),
				...(request.headers === undefined ? {} : { headers: request.headers }),
			},
			__callContext(),
		)
	},
}

export const workflows = {
	create: async (input) => await host().capability('packageWorkflowCreate', input ?? {}, __callContext()),
}
export const packages = null
export const events = null

export default {
	kody,
	credential,
	credentials,
	packageStorage,
	packageContext,
	packageSecrets,
	createAuthenticatedFetch,
	oauthClientCredentials,
	secretHeaders,
	email,
	workflows,
	packages,
	events,
}
`
