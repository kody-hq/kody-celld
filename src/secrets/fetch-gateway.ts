import { WorkerEntrypoint } from 'cloudflare:workers'
import type { GatewayEvent, UserCell } from '../cells/user-cell.ts'
import type { Env } from '../env.ts'
import { executeRun } from '../execute/engine.ts'
import type { RuntimeProps } from '../execute/runtime-host.ts'
import { integrationEventPayload, type IntegrationRecord } from '../integrations/store.ts'
import { dispatchTopic } from '../packages/subscriptions.ts'
import { privateHostsFromEnv } from '../lib/private-hosts-env.ts'
import { secretApprovalUrl } from './usage.ts'
import { isCredentialTransportAllowed, isHostApproved, requestHost } from './host-policy.ts'
import {
	collectPlaceholders,
	containsSecretPlaceholder,
	decodeSecretPlaceholderDelimiters,
	replaceSecretPlaceholders,
	type ReferencedProviderSecret,
	type SecretScope,
} from './placeholders.ts'
import { normalizeProviderHosts } from './provider-store.ts'
import { LANDING_REDIRECTED_HEADER, LANDING_URL_HEADER } from './gateway-landing.ts'

const RUN_HEADER = 'x-kody-run'
const MAX_INSPECTED_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 20
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const REQUEST_BODY_HEADERS = [
	'content-type',
	'content-length',
	'content-encoding',
	'content-language',
	'content-location',
]
const CROSS_ORIGIN_DROPPED_HEADERS = ['authorization', 'proxy-authorization', 'cookie']

const textLikeContentType =
	/^(?:text\/|application\/(?:json|x-www-form-urlencoded|xml|graphql|javascript|x-ndjson)|multipart\/form-data)/i
const jsonContentType = /^application\/(?:[\w.-]+\+)?json\s*(?:;|$)|^application\/x-ndjson\b/i

export type GatewaySend = { url: string; method?: string; headers?: Record<string, string>; body?: string | null }
export type GatewayReply = { status: number; ok: boolean; headers: Record<string, string>; body: string }

/**
 * `globalOutbound` for every sandbox isolate. Every `fetch()` from user or
 * package code passes through here:
 *  - requests without placeholders are forwarded untouched
 *  - requests with `{{secret:...}}` placeholders are resolved only when the
 *    destination host was approved by an account admin, over https (or a
 *    configured loopback host), and the referenced secrets exist for this
 *    user/package; otherwise the request never leaves and a 403 explains how
 *    to get approval
 *  - requests to this deployment's own /admin surface are blocked so sandbox
 *    code can never reach the approval boundary
 *  - redirects are followed here (never by fetch), each hop re-checked and
 *    recorded; a hop that fails the decision gets no placeholder-derived
 *    header, URL, or body
 */
export class FetchGateway extends WorkerEntrypoint<Env, RuntimeProps> {
	/**
	 * Same pipeline as `fetch()` for host-side callers (capabilities) over RPC,
	 * where `fetch` is a reserved name and Request/Response do not serialize.
	 */
	async send(input: GatewaySend): Promise<GatewayReply> {
		const init: RequestInit = { method: input.method ?? 'GET', headers: input.headers ?? {} }
		if (input.body != null && init.method !== 'GET' && init.method !== 'HEAD') init.body = input.body
		const response = await this.fetch(new Request(input.url, init))
		const headers: Record<string, string> = {}
		for (const [name, value] of response.headers) headers[name] = value
		return { status: response.status, ok: response.ok, headers, body: await response.text() }
	}

	override async fetch(request: Request): Promise<Response> {
		const runId = request.headers.get(RUN_HEADER)
		const headers = new Headers(request.headers)
		headers.delete(RUN_HEADER)
		const body = request.body && sendsBody(request.method) ? await request.arrayBuffer() : null
		const record = (hop: GatewayHop, event: GatewayRecordEvent) => {
			if (!runId) return
			this.ctx.waitUntil(
				this.env.USER.getByName(this.ctx.props.userId).runRecordGatewayEvent({
					runId,
					event: {
						at: new Date().toISOString(),
						method: hop.method,
						url: redactUrl(hop.url),
						host: requestHost(hop.url),
						...event,
						...(hop.redirect > 0 ? { redirect: hop.redirect } : {}),
					},
				}),
			)
		}

		// Redirects are followed here, never by fetch(), so every hop gets the
		// full gateway decision before anything placeholder-derived is sent.
		let hop: GatewayHop = { url: new URL(request.url), method: request.method, headers, body, redirect: 0 }
		for (;;) {
			const current = hop
			let result = await this.sendHop(current, (event) => record(current, event))
			if (result.kind === 'denied' && current.redirect > 0 && result.denial.code !== 'admin_surface_blocked') {
				// A redirect target that fails the decision gets no secret: drop the
				// headers that carried placeholders and send only if the URL and
				// body no longer reference one.
				const stripped = withoutPlaceholderHeaders(current)
				if (!inspectHop(stripped).hasPlaceholders) {
					const reason = `placeholder_headers_dropped:${result.denial.code}`
					hop = stripped
					result = await this.sendHop(stripped, (event) => record(stripped, { reason, ...event }))
				}
			}
			if (result.kind === 'denied') {
				const { denial } = result
				record(hop, {
					outcome: 'denied',
					status: denial.status,
					secrets: denial.secrets,
					reason: denial.reason ?? denial.code,
				})
				return landed(deny(denial.status, denial.code, denial.message, denial.details), hop)
			}
			const response = result.response
			const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get('location') : null
			const nextUrl = location === null ? null : parseUrl(location, hop.url)
			if (nextUrl === null || request.redirect === 'manual') return landed(response, hop)
			await response.body?.cancel()
			if (request.redirect === 'error') {
				throw new TypeError(`Redirect (${response.status}) not allowed: the request set redirect: 'error'.`)
			}
			if (hop.redirect >= MAX_REDIRECTS) {
				record(hop, { outcome: 'denied', status: 502, secrets: [], reason: 'redirect_limit_exceeded' })
				return landed(deny(502, 'redirect_limit_exceeded', `Stopped after ${MAX_REDIRECTS} redirects.`, {}), hop)
			}
			hop = nextHop(hop, response.status, nextUrl)
		}
	}

	/**
	 * One request, no redirect following: the gateway decision for this exact
	 * URL, then forward (placeholders replaced) or a denial for the caller.
	 */
	private async sendHop(hop: GatewayHop, record: (event: GatewayRecordEvent) => void): Promise<HopResult> {
		const { url, headers } = hop
		const host = requestHost(url)
		if (this.isOwnAdminSurface(url)) {
			return denied({
				status: 403,
				code: 'admin_surface_blocked',
				message: 'Sandbox code cannot call the Kody admin API.',
				details: {},
				secrets: [],
			})
		}

		const { urlText, bodyText, combined, hasPlaceholders } = inspectHop(hop)

		if (!hasPlaceholders) {
			const response = await forward(hop, url, headers, hop.body)
			record({ outcome: 'forwarded', status: response.status, secrets: [] })
			return { kind: 'sent', response }
		}

		const placeholders = collectPlaceholders(combined)
		const secretNames = new Set<string>()
		for (const s of placeholders.secrets) secretNames.add(s.name)
		for (const b of placeholders.basic) {
			secretNames.add(b.username)
			secretNames.add(b.password)
		}
		const integrationNames = [...new Set(placeholders.integrationTokens.map((t) => t.name))]
		const providerRefs = dedupeProviderRefs(placeholders.providerSecrets)
		// Run history names what was injected, never the values.
		const secrets = [
			...secretNames,
			...integrationNames.map((name) => `integration-token:${name}`),
			...providerRefs.map((p) => `secret/${p.provider}:${p.ref}`),
		]

		const allowInsecure = privateHostsFromEnv(this.env)
		if (!isCredentialTransportAllowed(url, allowInsecure)) {
			return denied({
				status: 403,
				code: 'secret_requires_https',
				reason: 'insecure_scheme',
				message: `Secrets are only injected over https. Request to ${url.protocol}//${host} was blocked.`,
				details: { host },
				secrets,
			})
		}

		const userCell = this.env.USER.getByName(this.ctx.props.userId)
		const packageName = this.ctx.props.packageName
		const approvedHosts = (await userCell.secretHostList()).map((h) => h.host)
		const hostApproved = isHostApproved(host, approvedHosts)
		const replacements = new Map<string, string>()

		// --- {{secret:name}} / {{secret-basic:...}}: admin-approved hosts only.
		if (secretNames.size > 0) {
			if (!hostApproved) {
				const approvalUrl = `${this.env.KODY_PUBLIC_URL}/admin/users/${this.ctx.props.userId}/secret-hosts`
				return denied({
					status: 403,
					code: 'secret_host_not_approved',
					message: `Host "${host}" is not approved for secret injection. Stop retrying; ask an account admin to approve it (POST ${approvalUrl} {"host":"${host}"}) and retry only after approval.`,
					details: { host, secrets: [...secretNames], approvalUrl },
					secrets,
				})
			}
			const refs: Array<{ name: string; scope: SecretScope | null }> = [
				...placeholders.secrets.map((s) => ({ name: s.name, scope: s.scope })),
				...placeholders.basic.flatMap((b) => [
					{ name: b.username, scope: b.scope },
					{ name: b.password, scope: b.scope },
				]),
			]
			const resolved = await userCell.secretResolveValues({ names: refs, packageName, enforceUsageLock: true })
			if (resolved.locked.length > 0) {
				const locked = resolved.locked[0]!
				const approvalUrl = secretApprovalUrl(this.env.KODY_PUBLIC_URL, locked.name, packageName ?? '')
				return denied({
					status: 403,
					code: 'secret_locked',
					message: `Secret "${locked.name}" is locked to approved packages. Ask the account owner to approve this package at ${approvalUrl}.`,
					details: { host, name: locked.name, allowedPackages: locked.allowedPackages, approvalUrl },
					secrets,
				})
			}
			if (resolved.missing.length > 0) {
				return denied({
					status: 404,
					code: 'secret_not_found',
					message: `Unknown secret(s): ${resolved.missing.join(', ')}. Save them with secretSet first.`,
					details: { host, missing: resolved.missing },
					secrets,
				})
			}
			for (const s of placeholders.secrets) replacements.set(s.placeholder, resolved.values[s.name] ?? '')
			for (const b of placeholders.basic) {
				const credentials = `${resolved.values[b.username] ?? ''}:${resolved.values[b.password] ?? ''}`
				const header = `Basic ${btoa(credentials)}`
				// Callers may write either the bare placeholder or `Basic {{...}}`;
				// both become a single well-formed header value.
				for (const scheme of ['Basic ', 'basic ', 'BASIC ', '']) replacements.set(`${scheme}${b.placeholder}`, header)
			}
		}

		// --- {{integration-token:name}}: the connection's own allowedHosts govern.
		const injectIntegrations = async (forceRefresh: boolean) => {
			for (const name of integrationNames) {
				const outcome = await userCell.integrationTokenResolve({ name, packageName, host, forceRefresh })
				if (!outcome.ok) {
					if (outcome.record && forceRefresh)
						this.notifyAuth('integration.auth.failed', outcome.record, outcome.message)
					return outcome
				}
				if (outcome.refreshed) this.notifyAuth('integration.auth.succeeded', outcome.record, null)
				for (const t of placeholders.integrationTokens) {
					if (t.name === name) replacements.set(t.placeholder, outcome.token)
				}
			}
			return null
		}
		if (integrationNames.length > 0) {
			const integrationDenied = await injectIntegrations(false)
			if (integrationDenied) {
				return denied({
					status: integrationDenied.status,
					code: integrationDenied.code,
					message: integrationDenied.message,
					details: {
						host,
						integration: integrationDenied.record
							? { name: integrationDenied.record.name, status: integrationDenied.record.status }
							: null,
					},
					secrets,
				})
			}
		}

		// --- {{secret/provider:ref}}: resolved by the bound provider package in a sealed run.
		if (providerRefs.length > 0) {
			const providerDenied = await this.injectProviderSecrets({
				userCell,
				providerRefs,
				placeholders: placeholders.providerSecrets,
				host,
				hostApproved,
				replacements,
			})
			if (providerDenied) {
				return denied({
					status: providerDenied.status,
					code: providerDenied.code,
					message: providerDenied.message,
					details: { host, ...providerDenied.details },
					secrets,
				})
			}
		}

		const jsonBody = isJsonContentType(headers.get('content-type'))
		const inject = () => {
			const injectedUrl = parseUrl(replaceSecretPlaceholders(urlText, replacements))
			if (!injectedUrl) {
				throw new InjectionError(
					'secret_invalid_url',
					'An injected value does not form a valid URL; the request was not sent.',
					{},
				)
			}
			const injectedHeaders = new Headers()
			for (const [name, value] of headers) {
				try {
					injectedHeaders.set(name, replaceSecretPlaceholders(value, replacements))
				} catch {
					throw new InjectionError(
						'secret_invalid_header_value',
						`The value injected into header "${name}" is not a valid HTTP header value (for example, it contains a newline); the request was not sent.`,
						{ header: name },
					)
				}
			}
			let injectedBody: BodyInit | null = hop.body
			const text = bodyText
			if (text !== null && [...replacements.keys()].some((placeholder) => text.includes(placeholder))) {
				// A JSON body gets each value JSON-string-escaped, so a quote or a
				// newline in a secret cannot break or extend the document.
				injectedBody = replaceSecretPlaceholders(text, jsonBody ? jsonStringEscaped(replacements) : replacements)
			}
			return forward(hop, injectedUrl, injectedHeaders, injectedBody)
		}

		try {
			let response = await inject()
			// A 401 with an integration token usually means the provider revoked or
			// expired it early: refresh once host-side and replay the request.
			if (response.status === 401 && integrationNames.length > 0) {
				const refreshDenied = await injectIntegrations(true)
				if (!refreshDenied) {
					await response.body?.cancel()
					response = await inject()
					record({ outcome: 'injected', status: response.status, secrets, reason: 'integration_refreshed' })
					return { kind: 'sent', response }
				}
			}
			record({ outcome: 'injected', status: response.status, secrets })
			return { kind: 'sent', response }
		} catch (error) {
			if (error instanceof InjectionError) {
				return denied({
					status: 400,
					code: error.code,
					message: error.message,
					details: { host, ...error.details },
					secrets,
				})
			}
			const reason = redactValues(error instanceof Error ? error.message : String(error), replacements)
			record({ outcome: 'error', status: null, secrets, reason })
			// oxlint-disable-next-line preserve-caught-error -- the cause can carry an injected value
			throw new TypeError(reason)
		}
	}

	private notifyAuth(
		topic: 'integration.auth.succeeded' | 'integration.auth.failed',
		record: IntegrationRecord,
		reason: string | null,
	) {
		this.ctx.waitUntil(
			dispatchTopic(this.env, this.ctx.exports, { id: this.ctx.props.userId, email: this.ctx.props.email }, topic, {
				integration: integrationEventPayload(record),
				source: 'refresh',
				...(reason ? { reason } : {}),
			}),
		)
	}

	/**
	 * Provider-backed secrets: for each `{{secret/<provider>:<ref>}}` the bound
	 * provider package runs sealed (no persisted result/logs) and returns
	 * `{ value, hosts, canonicalRef }`. The value is injected only when the
	 * destination host is one of the item's hosts or an admin-approved secret
	 * host, and the caller holds a grant when the binding is locked.
	 */
	private async injectProviderSecrets(input: {
		userCell: DurableObjectStub<UserCell>
		providerRefs: Array<{ provider: string; ref: string }>
		placeholders: Array<ReferencedProviderSecret>
		host: string
		hostApproved: boolean
		replacements: Map<string, string>
	}): Promise<{ status: number; code: string; message: string; details: Record<string, unknown> } | null> {
		const { userCell, host } = input
		const packageName = this.ctx.props.packageName
		const bindings = await userCell.secretProviderList()
		if (packageName !== null && bindings.some((b) => b.packageName === packageName)) {
			return {
				status: 403,
				code: 'secret_provider_recursion',
				message: `Package "${packageName}" is a bound secret provider and may not use {{secret/...}} placeholders itself; use {{secret:name}} for its door secret.`,
				details: {},
			}
		}
		const cacheTtlMs = providerCacheTtlMs(this.env)
		for (const { provider, ref } of input.providerRefs) {
			const auth = await userCell.secretProviderAuthorize({ providerId: provider, ref, packageName })
			if (!auth.ok) return { status: auth.status, code: auth.code, message: auth.message, details: { provider, ref } }
			let resolved = auth.cached
			if (!resolved) {
				const pkg = await userCell.packageGet(auth.binding.packageName)
				if (!pkg?.manifest.secretProvider) {
					return {
						status: 404,
						code: 'secret_provider_package_missing',
						message: `Provider "${provider}" is bound to package "${auth.binding.packageName}", which no longer declares kody.secretProvider.`,
						details: { provider },
					}
				}
				const run = await executeRun(this.env, this.ctx.exports, {
					kind: 'secret-provider',
					user: { id: this.ctx.props.userId, email: this.ctx.props.email },
					entry: {
						kind: 'package',
						packageName: auth.binding.packageName,
						entryPath: pkg.manifest.secretProvider.entry,
					},
					params: {
						providerId: provider,
						ref,
						config: auth.binding.config,
						doorSecretName: auth.binding.doorSecretName,
					},
					trigger: `secret-provider:${provider}`,
					sealed: true,
					timeoutMs: providerTimeoutMs(this.env),
				})
				if (!run.ok) {
					return {
						status: 502,
						code: 'secret_provider_failed',
						message: `Provider "${provider}" could not resolve ref "${ref}": ${run.error?.name ?? 'error'}: ${run.error?.message ?? 'unknown error'}`,
						details: { provider, ref, runId: run.runId },
					}
				}
				const parsed = parseProviderResult(run.result)
				if (!parsed) {
					return {
						status: 502,
						code: 'secret_provider_invalid_result',
						message: `Provider "${provider}" returned something other than { value: string, hosts?: string[], canonicalRef?: string } for ref "${ref}".`,
						details: { provider, ref, runId: run.runId },
					}
				}
				resolved = { ...parsed, canonicalRef: parsed.canonicalRef ?? ref, expiresAt: 0 }
				// Cached before the grant re-check so the alias -> canonical mapping is known next time.
				await userCell.secretProviderCachePut({
					providerId: provider,
					ref,
					entry: { value: resolved.value, hosts: resolved.hosts, canonicalRef: resolved.canonicalRef },
					ttlMs: cacheTtlMs,
				})
				if (auth.provisional || resolved.canonicalRef !== ref) {
					// Grants are held on canonical refs: re-check now that the provider told us which item this is.
					const recheck = await userCell.secretProviderAuthorize({
						providerId: provider,
						ref: resolved.canonicalRef,
						packageName,
						strict: true,
					})
					if (!recheck.ok)
						return { status: recheck.status, code: recheck.code, message: recheck.message, details: { provider, ref } }
				}
			}
			if (!isHostApproved(host, resolved.hosts) && !input.hostApproved) {
				return {
					status: 403,
					code: 'secret_provider_host_not_allowed',
					message: `Host "${host}" is not among the hosts of ${provider} item "${ref}" (${resolved.hosts.length ? resolved.hosts.join(', ') : 'none listed'}) and is not an admin-approved secret host.`,
					details: { provider, ref, itemHosts: resolved.hosts },
				}
			}
			for (const p of input.placeholders) {
				if (p.provider === provider && p.ref === ref) input.replacements.set(p.placeholder, resolved.value)
			}
		}
		return null
	}

	private isOwnAdminSurface(url: URL) {
		let publicUrl: URL
		try {
			publicUrl = new URL(this.env.KODY_PUBLIC_URL)
		} catch {
			return false
		}
		const sameHost = url.hostname.toLowerCase() === publicUrl.hostname.toLowerCase()
		return sameHost && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))
	}
}

function deny(status: number, code: string, message: string, details: Record<string, unknown>) {
	return Response.json({ error: code, message, ...details }, { status, headers: { 'x-kody-gateway': code } })
}

function dedupeProviderRefs(list: Array<ReferencedProviderSecret>) {
	const seen = new Set<string>()
	const out: Array<{ provider: string; ref: string }> = []
	for (const p of list) {
		const key = `${p.provider}\u0000${p.ref}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push({ provider: p.provider, ref: p.ref })
	}
	return out
}

function parseProviderResult(
	result: unknown,
): { value: string; hosts: Array<string>; canonicalRef: string | null } | null {
	if (typeof result !== 'object' || result === null || Array.isArray(result)) return null
	const record = result as Record<string, unknown>
	if (typeof record.value !== 'string') return null
	const canonicalRef =
		typeof record.canonicalRef === 'string' && record.canonicalRef.trim() && !/[\s{}]/.test(record.canonicalRef)
			? record.canonicalRef.trim()
			: null
	return { value: record.value, hosts: normalizeProviderHosts(record.hosts), canonicalRef }
}

function positiveInt(raw: string | undefined, fallback: number) {
	const value = Number(raw)
	return raw !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback
}

function providerCacheTtlMs(env: Env) {
	return positiveInt(env.KODY_SECRET_PROVIDER_CACHE_SECONDS, 300) * 1000
}

function providerTimeoutMs(env: Env) {
	return Math.max(1000, positiveInt(env.KODY_SECRET_PROVIDER_TIMEOUT_MS, 20_000))
}

function redactUrl(url: URL) {
	const copy = new URL(url.toString())
	for (const [key] of copy.searchParams) copy.searchParams.set(key, '…')
	return `${copy.origin}${copy.pathname}${copy.search ? '?…' : ''}`
}

type GatewayRecordEvent = Omit<GatewayEvent, 'at' | 'method' | 'url' | 'host'>

/** One request the gateway sends: the sandbox's own, or a redirect target. */
type GatewayHop = {
	url: URL
	method: string
	headers: Headers
	body: ArrayBuffer | null
	/** 0 for the sandbox's request, n for the nth followed redirect. */
	redirect: number
}

type GatewayDenial = {
	status: number
	code: string
	/** Run history reason when it differs from `code`. */
	reason?: string
	message: string
	details: Record<string, unknown>
	secrets: Array<string>
}

type HopResult = { kind: 'denied'; denial: GatewayDenial } | { kind: 'sent'; response: Response }

class InjectionError extends Error {
	readonly code: string
	readonly details: Record<string, unknown>
	constructor(code: string, message: string, details: Record<string, unknown>) {
		super(message)
		this.code = code
		this.details = details
	}
}

function denied(denial: GatewayDenial): HopResult {
	return { kind: 'denied', denial }
}

function sendsBody(method: string) {
	return method !== 'GET' && method !== 'HEAD'
}

function inspectHop(hop: GatewayHop) {
	const urlText = decodeSecretPlaceholderDelimiters(hop.url.toString())
	let headerText = ''
	for (const [name, value] of hop.headers) headerText += `${name}: ${value}\n`
	let bodyText: string | null = null
	if (hop.body !== null && hop.body.byteLength <= MAX_INSPECTED_BODY_BYTES) {
		const contentType = hop.headers.get('content-type') ?? ''
		if (!contentType || textLikeContentType.test(contentType)) bodyText = new TextDecoder().decode(hop.body)
	}
	const combined = `${urlText}\n${headerText}\n${bodyText ?? ''}`
	return { urlText, bodyText, combined, hasPlaceholders: containsSecretPlaceholder(combined) }
}

function withoutPlaceholderHeaders(hop: GatewayHop): GatewayHop {
	const headers = new Headers()
	for (const [name, value] of hop.headers) {
		if (!containsSecretPlaceholder(value)) headers.set(name, value)
	}
	return { ...hop, headers }
}

/** Fetch's redirect rules: method rewrite, and credentials stay on their origin. */
function nextHop(hop: GatewayHop, status: number, url: URL): GatewayHop {
	const toGet =
		(status === 303 && hop.method !== 'HEAD') || ((status === 301 || status === 302) && hop.method === 'POST')
	const headers = new Headers(hop.headers)
	if (toGet) for (const name of REQUEST_BODY_HEADERS) headers.delete(name)
	if (url.origin !== hop.url.origin) for (const name of CROSS_ORIGIN_DROPPED_HEADERS) headers.delete(name)
	return { url, method: toGet ? 'GET' : hop.method, headers, body: toGet ? null : hop.body, redirect: hop.redirect + 1 }
}

/** Marks a followed redirect's final response; strips any upstream copy of the markers. */
function landed(response: Response, hop: GatewayHop) {
	const spoofed = response.headers.has(LANDING_URL_HEADER) || response.headers.has(LANDING_REDIRECTED_HEADER)
	if (response.status < 200 || (hop.redirect === 0 && !spoofed)) return response
	const headers = new Headers(response.headers)
	headers.delete(LANDING_URL_HEADER)
	headers.delete(LANDING_REDIRECTED_HEADER)
	if (hop.redirect > 0) {
		headers.set(LANDING_URL_HEADER, hop.url.toString())
		headers.set(LANDING_REDIRECTED_HEADER, '1')
	}
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function parseUrl(value: string, base?: URL) {
	try {
		return new URL(value, base)
	} catch {
		return null
	}
}

function isJsonContentType(contentType: string | null) {
	return contentType !== null && jsonContentType.test(contentType)
}

function jsonStringEscaped(replacements: ReadonlyMap<string, string>) {
	return new Map([...replacements].map(([placeholder, value]) => [placeholder, JSON.stringify(value).slice(1, -1)]))
}

function redactValues(text: string, replacements: ReadonlyMap<string, string>) {
	let next = text
	for (const value of replacements.values()) {
		if (value) next = next.replaceAll(value, '[redacted]')
	}
	return next
}

async function forward(hop: GatewayHop, url: URL, headers: Headers, body: BodyInit | null) {
	const init: RequestInit = { method: hop.method, headers, redirect: 'manual' }
	if (body !== null && sendsBody(hop.method)) init.body = body
	return fetch(url, init)
}
