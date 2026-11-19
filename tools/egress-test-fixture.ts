import {
	egressTargetHeader,
	egressErrorHeader,
	egressMessageHeader,
	egressRefusedStatus,
} from '../src/lib/egress-protocol.ts'
import { hostMatchesAllowlist, isPrivateHostname } from '../src/lib/host-allowlist.ts'

/** Fetch-boundary fixtures shared by outbound caller tests. */
export function forwardedTarget(input: RequestInfo | URL, init?: RequestInit): URL {
	const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
	return new URL(headers.get(egressTargetHeader) ?? (input instanceof Request ? input.url : String(input)))
}

export function forwarderRefusal(
	host: string,
	addresses: Array<string> | null,
	allowed: Array<string> = [],
): Response | null {
	let message: string | undefined
	if (!addresses?.length) message = `Could not resolve "${host}" through the system resolver.`
	else if (!hostMatchesAllowlist(host, allowed)) {
		const privateAddress = addresses.find(
			(address) => isPrivateHostname(address) && !hostMatchesAllowlist(address, allowed),
		)
		if (privateAddress)
			message = `"${host}" resolves to private address ${privateAddress}. Add it to KODY_PRIVATE_HOSTS to allow it.`
	}
	return message
		? Response.json(
				{ message },
				{
					status: egressRefusedStatus,
					headers: { [egressErrorHeader]: 'refused', [egressMessageHeader]: encodeURIComponent(message) },
				},
			)
		: null
}
