import { KodyError } from './errors.ts'
import { hostMatchesAllowlist, isPrivateHostname } from './host-allowlist.ts'
import { privateHostsEnvKey } from './private-hosts-env.ts'
import { egressOrigin, egressTargetHeader, egressErrorHeader, egressRefusedStatus } from './egress-protocol.ts'

export type ResolvedHostPolicy = { allowPrivateHosts: ReadonlyArray<string> }
export type RefuseHost = (message: string) => Error

export function defaultRefuseHost(message: string): Error {
	return new KodyError('host_not_allowed', message, { status: 403 })
}

export function assertLiteralHostAllowed(
	url: URL,
	allowPrivateHosts: ReadonlyArray<string>,
	refuse: RefuseHost = defaultRefuseHost,
): boolean {
	const host = url.hostname.toLowerCase()
	if (hostMatchesAllowlist(host, allowPrivateHosts)) return true
	if (isPrivateHostname(host)) {
		throw refuse(
			`"${host}" is a loopback/private host. Add it (or its CIDR range) to ${privateHostsEnvKey} on the server to allow it.`,
		)
	}
	return false
}

async function forward(
	url: URL,
	path: string,
	init: RequestInit,
	options: { fetch?: typeof fetch | undefined; refuse?: RefuseHost | undefined },
): Promise<Response> {
	const headers = new Headers(init.headers)
	headers.delete(egressErrorHeader)
	headers.set(egressTargetHeader, url.href)
	let response: Response
	try {
		response = await (options.fetch ?? fetch)(`${egressOrigin}/${path}`, {
			...init,
			headers,
			redirect: 'manual',
		})
	} catch (error) {
		if (init.signal?.aborted) throw error
		throw new KodyError('egress_unavailable', 'The outbound forwarder is unavailable.', { status: 502 })
	}
	if (response.headers.has(egressErrorHeader)) {
		const { message } = (await response.json()) as { message: string }
		if (response.status === egressRefusedStatus) throw (options.refuse ?? defaultRefuseHost)(message)
		throw new KodyError('egress_unavailable', message, { status: 502 })
	}
	return response
}

export async function outboundFetch(
	input: string | URL,
	init: RequestInit,
	policy: ResolvedHostPolicy,
	options: { fetch?: typeof fetch | undefined; refuse?: RefuseHost | undefined } = {},
): Promise<Response> {
	const url = new URL(input)
	assertLiteralHostAllowed(url, policy.allowPrivateHosts, options.refuse)
	return forward(url, 'fetch', init, options)
}

/** Resolves a target without opening the downstream connection. */
export async function assertOutboundUrlAllowed(
	url: URL,
	policy: ResolvedHostPolicy,
	options: { fetch?: typeof fetch | undefined; refuse?: RefuseHost | undefined } = {},
): Promise<void> {
	assertLiteralHostAllowed(url, policy.allowPrivateHosts, options.refuse)
	const response = await forward(url, 'resolve', { method: 'POST' }, options)
	if (!response.ok) throw new KodyError('egress_unavailable', 'The outbound resolver is unavailable.', { status: 502 })
	await response.body?.cancel()
}
