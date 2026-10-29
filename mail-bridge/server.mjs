// kody mail bridge: SMTP in -> POST /email/inbound/bridge, POST /send -> SMTP relay.
import { readFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { createTransport } from 'nodemailer'
import { SMTPServer } from 'smtp-server'
import {
	acceptsRecipient,
	bareMessageId,
	bearerMatches,
	buildMailOptions,
	configFromEnv,
	normalizeAddress,
	receivedHeader,
	smtpReplyFor,
} from './lib.mjs'

const config = configFromEnv(process.env)

function log(level, message, extra = {}) {
	const line = { at: new Date().toISOString(), level, message, ...extra }
	process.stdout.write(`${JSON.stringify(line)}\n`)
}

function smtpError(code, message) {
	const error = new Error(message)
	error.responseCode = code
	return error
}

// ---------------------------------------------------------------- inbound SMTP

async function forwardToKody(raw, session) {
	const recipients = session.envelope.rcptTo.map((r) => normalizeAddress(r.address))
	const from = session.envelope.mailFrom ? normalizeAddress(session.envelope.mailFrom.address) : ''
	const trace = Buffer.from(
		receivedHeader({
			clientHostname: session.clientHostname,
			remoteAddress: session.remoteAddress,
			hostname: config.hostname,
			recipients,
		}),
	)
	const response = await fetch(`${config.kodyUrl}/email/inbound/bridge`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${config.inboundToken}`,
			'content-type': 'message/rfc822',
			'x-kody-envelope-from': from,
			'x-kody-envelope-to': recipients.join(','),
		},
		body: Buffer.concat([trace, raw]),
		signal: AbortSignal.timeout(config.kodyTimeoutMs),
	})
	let body = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	return { status: response.status, body }
}

const smtp = new SMTPServer({
	name: config.hostname,
	banner: 'kody mail bridge',
	size: config.maxBytes,
	authOptional: true,
	disabledCommands: ['AUTH'],
	disableReverseLookup: true,
	hideSTARTTLS: !config.tls,
	...(config.tls ? { key: readFileSync(config.tls.keyPath), cert: readFileSync(config.tls.certPath) } : {}),
	onRcptTo(address, _session, callback) {
		if (!acceptsRecipient(config, address.address)) {
			return callback(smtpError(550, '5.1.1 Relay access denied: not a Kody address'))
		}
		callback()
	},
	onData(stream, session, callback) {
		const chunks = []
		let size = 0
		stream.on('data', (chunk) => {
			size += chunk.length
			if (size <= config.maxBytes) chunks.push(chunk)
		})
		stream.on('error', (error) => callback(smtpError(451, `4.3.0 ${error.message}`)))
		stream.on('end', async () => {
			if (stream.sizeExceeded || size > config.maxBytes) {
				return callback(smtpError(552, '5.3.4 Message exceeds the bridge size limit'))
			}
			try {
				const result = await forwardToKody(Buffer.concat(chunks), session)
				const reply = smtpReplyFor(result.status, result.body)
				log(reply.code === 250 ? 'info' : 'warn', 'inbound', {
					id: session.id,
					recipients: session.envelope.rcptTo.length,
					bytes: size,
					kodyStatus: result.status,
					smtp: reply.code,
				})
				if (reply.code === 250) return callback(null, reply.message)
				callback(smtpError(reply.code, reply.message))
			} catch (error) {
				log('error', 'inbound forward failed', { id: session.id, error: error.message })
				callback(smtpError(451, '4.3.0 Kody is temporarily unavailable, try later'))
			}
		})
	},
})
smtp.on('error', (error) => log('error', 'smtp', { error: error.message }))

// ------------------------------------------------------------- outbound HTTP

// Relay sockets are opened through nodemailer's getSocket hook so the shutdown
// cutoff can destroy them: an abandoned send must not complete after it was
// reported failed.
function relaySocket(options, callback) {
	if (drain.cutOff) return callback(new Error(SHUTDOWN_CUTOFF))
	const socket = net.connect({
		host: options.host || 'localhost',
		port: Number(options.port) || (options.secure ? 465 : 587),
	})
	drain.sockets.add(socket)
	socket.once('close', () => drain.sockets.delete(socket))
	socket.setTimeout(config.sendTimeoutMs, () => socket.destroy(new Error('Connection timeout')))
	socket.once('error', callback)
	socket.once('connect', () => {
		socket.setTimeout(0)
		socket.off('error', callback)
		callback(null, { connection: socket })
	})
}

const transport = createTransport({
	...(config.smtpUrl
		? { url: config.smtpUrl, socketTimeout: config.sendTimeoutMs }
		: { direct: true, name: config.hostname }),
	connectionTimeout: config.sendTimeoutMs,
	getSocket: relaySocket,
})
const transportKind = config.smtpUrl ? 'relay' : 'direct'

async function reportEvent(messageId, event, detail) {
	if (!config.reportEvents) return
	try {
		const response = await fetch(`${config.kodyUrl}/email/events/bridge`, {
			method: 'POST',
			headers: { authorization: `Bearer ${config.inboundToken}`, 'content-type': 'application/json' },
			body: JSON.stringify({ messageId, event, detail, at: new Date().toISOString() }),
			signal: AbortSignal.timeout(config.kodyTimeoutMs),
		})
		if (!response.ok) log('warn', 'event not accepted by Kody', { messageId, event, status: response.status })
	} catch (error) {
		log('warn', 'event report failed', { messageId, event, error: error.message })
	}
}

// Shutdown drain. Accepted deliveries are tracked so SIGTERM waits for them;
// at the cutoff, relay sockets still open are destroyed and their sends are
// reported `failed`, leaving the event report (bounded by kodyTimeoutMs) to
// finish before exit.
const SHUTDOWN_CUTOFF = 'Bridge shut down before the relay confirmed delivery.'
const drain = {
	active: false,
	cutOff: false,
	deliveries: new Set(),
	sockets: new Set(),
	sendCutoffMs: config.sendTimeoutMs,
	exitAfterMs: config.sendTimeoutMs + config.kodyTimeoutMs + 5_000,
}

async function deliver(options) {
	const messageId = bareMessageId(options.messageId)
	try {
		const info = await transport.sendMail(options)
		const rejected = info.rejected?.length ?? 0
		log('info', 'outbound', { messageId, transport: transportKind, accepted: info.accepted?.length ?? 0, rejected })
		await reportEvent(
			messageId,
			rejected > 0 && (info.accepted?.length ?? 0) === 0 ? 'failed' : 'sent',
			rejected > 0 ? `Relay rejected ${rejected} recipient(s).` : (info.response ?? null),
		)
	} catch (error) {
		const detail = drain.cutOff ? SHUTDOWN_CUTOFF : error.message
		log('warn', 'outbound failed', { messageId, error: detail })
		await reportEvent(messageId, 'failed', detail)
	}
}

function readJson(request, limit) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let size = 0
		request.on('data', (chunk) => {
			size += chunk.length
			if (size > limit) {
				reject(Object.assign(new Error('Body too large.'), { status: 413 }))
				request.destroy()
				return
			}
			chunks.push(chunk)
		})
		request.on('end', () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
			} catch {
				reject(Object.assign(new Error('Body must be JSON.'), { status: 400 }))
			}
		})
		request.on('error', reject)
	})
}

function respond(response, status, payload) {
	response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
	response.end(JSON.stringify(payload))
}

const api = http.createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', 'http://bridge')
	if (request.method === 'GET' && url.pathname === '/health') {
		if (drain.active) return respond(response, 503, { ok: false, error: 'shutting_down' })
		return respond(response, 200, { ok: true, transport: transportKind, domains: config.domains })
	}
	if (request.method !== 'POST' || url.pathname !== '/send') {
		return respond(response, 404, { error: 'not_found' })
	}
	if (drain.active) return respond(response, 503, { error: 'shutting_down' })
	if (!bearerMatches(request.headers.authorization, config.token)) {
		return respond(response, 401, { error: 'unauthorized' })
	}
	let options
	try {
		// Base64 attachments inflate the JSON by ~4/3; allow for it.
		const body = await readJson(request, Math.ceil(config.maxBytes * 1.5))
		options = buildMailOptions(config, body)
	} catch (error) {
		return respond(response, error.status ?? 400, { error: 'invalid_message', message: error.message })
	}
	// Shutdown may have started while the body was being read.
	if (drain.active) return respond(response, 503, { error: 'shutting_down' })
	const delivery = deliver(options)
	drain.deliveries.add(delivery)
	void delivery.finally(() => drain.deliveries.delete(delivery))
	respond(response, 202, { messageId: bareMessageId(options.messageId), status: 'queued' })
})

// ------------------------------------------------------------------ startup

smtp.listen(config.smtpPort, config.bind, () =>
	log('info', 'smtp listening', { bind: config.bind, port: config.smtpPort, domains: config.domains }),
)
api.listen(config.httpPort, config.bind, () =>
	log('info', 'http listening', { port: config.httpPort, transport: transportKind }),
)
if (config.smtpUrl) {
	transport.verify().then(
		() => log('info', 'relay verified'),
		(error) => log('warn', 'relay verification failed (will retry per message)', { error: error.message }),
	)
}

async function shutdown(signal) {
	if (drain.active) return
	drain.active = true
	log('info', 'shutting down', { signal, inFlight: drain.deliveries.size })
	setTimeout(() => {
		log('error', 'shutdown deadline passed with deliveries unreported', { inFlight: drain.deliveries.size })
		api.closeAllConnections()
		process.exit(1)
	}, drain.exitAfterMs).unref()
	const cutoff = setTimeout(() => {
		drain.cutOff = true
		for (const socket of drain.sockets) socket.destroy()
	}, drain.sendCutoffMs)
	const smtpClosed = new Promise((resolve) => smtp.close(resolve))
	await Promise.allSettled([...drain.deliveries])
	clearTimeout(cutoff)
	await smtpClosed
	await new Promise((resolve) => api.close(resolve))
	log('info', 'shutdown complete')
	process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
