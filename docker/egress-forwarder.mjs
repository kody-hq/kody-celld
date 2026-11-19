import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { hostMatchesAllowlist, isPrivateHostname } from '../src/lib/host-allowlist.ts'
import { privateHostsFromEnv } from '../src/lib/private-hosts-env.ts'
import { egressOrigin, egressTargetHeader, egressErrorHeader, egressRefusedStatus } from '../src/lib/egress-protocol.ts'

const hopHeaders = [
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
]

function cleanHeaders(headers) {
	const result = { ...headers }
	const connection = String(result.connection ?? '')
		.split(',')
		.map((name) => name.trim().toLowerCase())
	for (const name of [...hopHeaders, ...connection, egressTargetHeader, egressErrorHeader]) delete result[name]
	return result
}

class Refused extends Error {}

async function resolveTarget(url, allowed) {
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
	const named = hostMatchesAllowlist(host, allowed)
	if (!named && isPrivateHostname(host))
		throw new Refused(`"${host}" is a private host not allowed by KODY_PRIVATE_HOSTS.`)
	let addresses
	try {
		addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await dns.lookup(host, { all: true })
	} catch {
		throw new Refused(`Could not resolve "${host}" through the system resolver.`)
	}
	if (!addresses.length) throw new Refused(`Could not resolve "${host}": no addresses.`)
	for (const { address } of addresses) {
		if (!isIP(address)) throw new Refused(`Could not resolve "${host}": invalid address.`)
		if (!named && isPrivateHostname(address) && !hostMatchesAllowlist(address, allowed)) {
			throw new Refused(
				`"${host}" resolves to private address ${address}. Add the address or its range to KODY_PRIVATE_HOSTS to allow it.`,
			)
		}
	}
	return addresses[0]
}

export function createEgressForwarder(env) {
	const allowed = privateHostsFromEnv(env)
	return http.createServer(async (request, response) => {
		let upstream
		const abort = () => upstream?.destroy()
		request.once('aborted', abort)
		request.once('error', (error) => upstream?.destroy(error))
		response.once('close', abort)
		try {
			if (request.url === '/health' && request.method === 'GET') {
				response.writeHead(204).end()
				return
			}
			if (request.url !== '/fetch' && request.url !== '/resolve') {
				response.writeHead(404).end()
				return
			}
			const raw = request.headers[egressTargetHeader]
			if (typeof raw !== 'string') throw new Refused('An outbound target URL is required.')
			let url
			try {
				url = new URL(raw)
			} catch {
				throw new Refused('Invalid outbound target URL.')
			}
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
				throw new Refused('Outbound targets must be http(s) URLs without credentials.')
			}
			const address = await resolveTarget(url, allowed)
			if (response.destroyed) return
			if (request.url === '/resolve') {
				response.writeHead(204).end()
				return
			}
			const headers = cleanHeaders(request.headers)
			headers.host = url.host
			upstream = (url.protocol === 'https:' ? https : http).request(url, {
				method: request.method,
				headers,
				agent: false,
				lookup: (_host, options, callback) => {
					if (options.all) callback(null, [address])
					else callback(null, address.address, address.family)
				},
			})
			upstream.setTimeout(120_000, () => upstream.destroy(new Error('Outbound request timed out.')))
			const incoming = new Promise((resolve, reject) => {
				upstream.once('response', resolve)
				upstream.once('error', reject)
			})
			request.pipe(upstream)
			const result = await incoming
			response.writeHead(result.statusCode, result.statusMessage, cleanHeaders(result.headers))
			await pipeline(result, response)
		} catch (error) {
			if (upstream) request.unpipe(upstream)
			request.resume()
			upstream?.destroy()
			if (response.headersSent || response.destroyed) {
				response.destroy()
				return
			}
			const refused = error instanceof Refused
			response.writeHead(refused ? egressRefusedStatus : 502, {
				'content-type': 'application/json',
				[egressErrorHeader]: refused ? 'refused' : 'unavailable',
			})
			response.end(JSON.stringify({ message: refused ? error.message : 'The outbound connection failed.' }))
		}
	})
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const server = createEgressForwarder(process.env)
	const address = new URL(egressOrigin)
	server.listen(Number(address.port), address.hostname, () => console.log('[kody-celld] outbound forwarder ready'))
	for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)))
}
