/**
 * Test-only DNS-over-HTTPS stub for the resolved-address guard. Not imported by runtime code.
 * Every name resolves to a public documentation-range address unless `answers` says otherwise.
 */

export const testDnsResolverUrl = 'https://dns.test/dns-query'

export type DohStub = ((input: string, init?: RequestInit) => Promise<Response>) & { queries: Array<string> }

/** `answers` maps a hostname to its A/AAAA addresses (IPv6 when the address has a colon). */
export function dohStub(answers: Record<string, Array<string>> = {}, fallback = ['93.184.216.34']): DohStub {
	const queries: Array<string> = []
	const stub = (async (input: string) => {
		const url = new URL(String(input))
		const name = url.searchParams.get('name') ?? ''
		const type = url.searchParams.get('type')
		queries.push(`${name}/${type}`)
		const addresses = answers[name] ?? fallback
		const wanted = addresses.filter((address) => address.includes(':') === (type === 'AAAA'))
		return Response.json({ Status: 0, Answer: wanted.map((data) => ({ type: type === 'AAAA' ? 28 : 1, data })) })
	}) as DohStub
	stub.queries = queries
	return stub
}

/** Spread into package-source options: every name resolves to a public address. */
export function publicTestDns() {
	return { dnsResolverUrl: testDnsResolverUrl, dnsFetch: dohStub() }
}
