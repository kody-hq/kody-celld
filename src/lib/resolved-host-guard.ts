import { KodyError } from './errors.ts'
import { hostMatchesAllowlist, isPrivateHostname, parseIpLiteral } from './host-allowlist.ts'
import { privateHostsEnvKey } from './private-hosts-env.ts'

/**
 * Resolved-address check shared by every server-side outbound URL guard (MCP servers, package
 * sources, browser rendering). The literal-host checks in each guard catch private names and IP
 * literals; this one looks the name up through DNS-over-HTTPS and refuses any private answer that
 * no IP/CIDR entry of KODY_PRIVATE_HOSTS allows, so a public name pointing into the LAN is refused.
 */

export const dnsResolverEnvKey = 'KODY_DNS_RESOLVER_URL'
export const defaultDnsResolverUrl = 'https://cloudflare-dns.com/dns-query'

export type DnsResolverEnv = { KODY_DNS_RESOLVER_URL?: string }

/** `KODY_DNS_RESOLVER_URL` (https only) or the default. Throws a plain Error naming the variable. */
export function dnsResolverUrlFromEnv(env: DnsResolverEnv): string {
	const raw = env.KODY_DNS_RESOLVER_URL?.trim() || defaultDnsResolverUrl
	try {
		const parsed = new URL(raw)
		if (parsed.protocol !== 'https:') throw new Error('not https')
		return parsed.href
	} catch {
		throw new Error(`${dnsResolverEnvKey}: expected an https URL, got "${raw}".`)
	}
}

export type ResolvedHostPolicy = {
	allowPrivateHosts: ReadonlyArray<string>
	dnsResolverUrl: string
}

/** Builds the error a refused hop throws; each caller keeps its own error code. */
export type RefuseHost = (message: string) => Error

type DnsFetch = (input: string, init: RequestInit) => Promise<Response>
type DnsJson = { Status?: number; Answer?: Array<{ type: number; data: string }> }

async function lookup(host: string, type: 'A' | 'AAAA', resolverUrl: string, fetchImpl: DnsFetch) {
	const url = new URL(resolverUrl)
	url.searchParams.set('name', host)
	url.searchParams.set('type', type)
	const response = await fetchImpl(url.href, {
		headers: { accept: 'application/dns-json' },
		signal: AbortSignal.timeout(5_000),
	})
	if (!response.ok) throw new Error(`resolver HTTP ${response.status}`)
	const body = (await response.json()) as DnsJson
	if (body.Status !== 0 && body.Status !== undefined) throw new Error(`resolver status ${body.Status}`)
	const wanted = type === 'A' ? 1 : 28
	return (body.Answer ?? []).filter((a) => a.type === wanted).map((a) => a.data.toLowerCase())
}

/**
 * DoH answers for one logical operation (one MCP call, one package install), keyed by host.
 * Never shared across operations: that would widen the rebinding gap (#45).
 */
export type DnsMemo = Map<string, Promise<Array<string>>>

async function resolveAddresses(host: string, resolverUrl: string, fetchImpl: DnsFetch) {
	const [a, aaaa] = await Promise.all([
		lookup(host, 'A', resolverUrl, fetchImpl),
		lookup(host, 'AAAA', resolverUrl, fetchImpl),
	])
	const addresses = [...a, ...aaaa]
	// An empty answer is a failed lookup too: refused, and (like any failure) not kept in the memo.
	if (addresses.length === 0) throw new Error('no A/AAAA records')
	return addresses
}

export function defaultRefuseHost(message: string): Error {
	return new KodyError('host_not_allowed', message, { status: 403 })
}

/**
 * Best-effort resolved-IP check before one hop (the first request or a redirect target). IP
 * literals and names matching a KODY_PRIVATE_HOSTS name / `*.suffix` entry skip the lookup (the
 * literal checks already ran). A failed or empty lookup is refused. Limit: the caller's `fetch`
 * resolves the name again when it connects, so fast DNS rebinding is not excluded (#45).
 */
export async function assertResolvedHostAllowed(
	url: URL,
	policy: ResolvedHostPolicy,
	options: { fetch?: DnsFetch | undefined; memo?: DnsMemo | undefined; refuse?: RefuseHost | undefined } = {},
): Promise<void> {
	const refuse = options.refuse ?? defaultRefuseHost
	const fetchImpl: DnsFetch = options.fetch ?? ((input, init) => fetch(input, init))
	const memo = options.memo
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
	if (parseIpLiteral(host)) return
	if (hostMatchesAllowlist(host, policy.allowPrivateHosts)) return
	let addresses: Array<string>
	try {
		let pending = memo?.get(host)
		if (!pending) {
			pending = resolveAddresses(host, policy.dnsResolverUrl, fetchImpl)
			// Concurrent hops share the lookup; a failure is not remembered, so the next hop asks again.
			if (memo) {
				memo.set(host, pending)
				pending.catch(() => {
					if (memo.get(host) === pending) memo.delete(host)
				})
			}
		}
		addresses = await pending
	} catch (error) {
		throw refuse(
			`Could not resolve "${host}" through ${dnsResolverEnvKey} (${error instanceof Error ? error.message : String(error)}).`,
		)
	}
	for (const address of addresses) {
		const literal = address.includes(':') ? `[${address}]` : address
		if (isPrivateHostname(literal) && !hostMatchesAllowlist(address, policy.allowPrivateHosts)) {
			throw refuse(
				`"${host}" resolves to private address ${address}. Add the address or its range to ${privateHostsEnvKey} to allow it.`,
			)
		}
	}
}
