// End-to-end: real SMTP session -> bridge -> fake Kody, and POST /send -> fake relay -> event back.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createTransport } from 'nodemailer'
import { SMTPServer } from 'smtp-server'

const here = new URL('.', import.meta.url).pathname

function freePort() {
	return new Promise((resolve) => {
		const server = net.createServer()
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address()
			server.close(() => resolve(port))
		})
	})
}

function waitFor(check, timeoutMs = 10_000) {
	const started = Date.now()
	return new Promise((resolve, reject) => {
		const tick = async () => {
			try {
				const value = await check()
				if (value) return resolve(value)
			} catch {
				// not ready yet
			}
			if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
			setTimeout(tick, 100)
		}
		void tick()
	})
}

function spawnBridge(ports, env = {}) {
	const child = spawn(process.execPath, ['server.mjs'], {
		cwd: here,
		env: {
			...process.env,
			KODY_URL: `http://127.0.0.1:${ports.kody}`,
			KODY_EMAIL_DOMAIN: 'kody.test',
			KODY_EMAIL_INBOUND_TOKEN: 'inbound-token-for-test',
			MAIL_BRIDGE_TOKEN: 'bridge-token-for-test',
			MAIL_BRIDGE_SMTP_URL: `smtp://127.0.0.1:${ports.relay}?ignoreTLS=true`,
			MAIL_BRIDGE_SMTP_PORT: String(ports.smtp),
			MAIL_BRIDGE_HTTP_PORT: String(ports.http),
			MAIL_BRIDGE_HOSTNAME: 'bridge.kody.test',
			...env,
		},
		stdio: ['ignore', 'pipe', 'inherit'],
	})
	child.stdout.on('data', () => {})
	child.exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
	return child
}

function postSend(httpPort, subject) {
	return fetch(`http://127.0.0.1:${httpPort}/send`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: 'Bearer bridge-token-for-test' },
		body: JSON.stringify({ from: 'kent@kody.test', to: ['friend@example.com'], subject, text: 'body' }),
	})
}

/** Listens on a free port; SMTPServer keeps its net.Server on `.server`. */
function listen(server) {
	const inner = server.server ?? server
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(inner.address().port)))
}

/** Fake Kody that records bridge delivery events. */
async function eventRecorder(onEvent = () => {}) {
	const events = []
	const server = http.createServer((request, response) => {
		const chunks = []
		request.on('data', (c) => chunks.push(c))
		request.on('end', () => {
			if (request.url === '/email/events/bridge') {
				events.push(JSON.parse(Buffer.concat(chunks).toString()))
				onEvent()
			}
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end('{}')
		})
	})
	return { events, server, port: await listen(server) }
}

const kodyRequests = []
const relayMessages = []
let bridge
let ports
let cleanup = () => {}

describe('mail bridge', () => {
	after(() => cleanup())
	before(async () => {
		ports = { kody: await freePort(), relay: await freePort(), smtp: await freePort(), http: await freePort() }
		const fakeKody = http.createServer((request, response) => {
			const chunks = []
			request.on('data', (c) => chunks.push(c))
			request.on('end', () => {
				const body = Buffer.concat(chunks)
				kodyRequests.push({ url: request.url, headers: request.headers, body })
				response.setHeader('content-type', 'application/json')
				if (request.url === '/email/inbound/bridge') {
					const to = request.headers['x-kody-envelope-to'] ?? ''
					if (to.includes('nobody@')) {
						response.writeHead(404)
						return response.end(JSON.stringify({ error: 'not_accepted' }))
					}
					response.writeHead(200)
					return response.end(JSON.stringify({ accepted: [to] }))
				}
				response.writeHead(200)
				response.end('{}')
			})
		})
		await new Promise((resolve) => fakeKody.listen(ports.kody, '127.0.0.1', resolve))
		const relay = new SMTPServer({
			authOptional: true,
			disabledCommands: ['AUTH', 'STARTTLS'],
			onData(stream, session, callback) {
				const chunks = []
				stream.on('data', (c) => chunks.push(c))
				stream.on('end', () => {
					relayMessages.push({ envelope: session.envelope, raw: Buffer.concat(chunks).toString() })
					callback(null, 'OK relayed')
				})
			},
		})
		await new Promise((resolve) => relay.listen(ports.relay, '127.0.0.1', resolve))
		bridge = spawnBridge({ kody: ports.kody, smtp: ports.smtp, http: ports.http, relay: ports.relay })
		cleanup = () => {
			bridge.kill('SIGTERM')
			fakeKody.close()
			relay.close()
		}
		await waitFor(async () => (await fetch(`http://127.0.0.1:${ports.http}/health`)).ok)
	})

	it('forwards SMTP deliveries to Kody with the envelope and a Received header', async () => {
		const client = createTransport({ host: '127.0.0.1', port: ports.smtp, ignoreTLS: true })
		const info = await client.sendMail({
			from: 'sender@example.com',
			to: 'kent+tag@kody.test',
			subject: 'Hello bridge',
			text: 'hi',
		})
		assert.deepEqual(info.accepted, ['kent+tag@kody.test'])
		const inbound = kodyRequests.find((r) => r.url === '/email/inbound/bridge')
		assert.ok(inbound)
		assert.equal(inbound.headers.authorization, 'Bearer inbound-token-for-test')
		assert.equal(inbound.headers['content-type'], 'message/rfc822')
		assert.equal(inbound.headers['x-kody-envelope-from'], 'sender@example.com')
		assert.equal(inbound.headers['x-kody-envelope-to'], 'kent+tag@kody.test')
		const raw = inbound.body.toString()
		assert.match(raw, /^Received: from .*\s+by bridge\.kody\.test \(kody-mail-bridge\)/s)
		assert.match(raw, /Subject: Hello bridge/)
	})

	it('rejects foreign recipients at RCPT and unknown inboxes at DATA', async () => {
		const client = createTransport({ host: '127.0.0.1', port: ports.smtp, ignoreTLS: true })
		await assert.rejects(
			client.sendMail({ from: 'sender@example.com', to: 'someone@other.test', subject: 'x', text: 'x' }),
			/Relay access denied/,
		)
		await assert.rejects(
			client.sendMail({ from: 'sender@example.com', to: 'nobody@kody.test', subject: 'x', text: 'x' }),
			/No such Kody inbox/,
		)
	})

	it('sends via the relay and reports a delivery event to Kody', async () => {
		const unauthorized = await fetch(`http://127.0.0.1:${ports.http}/send`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		})
		assert.equal(unauthorized.status, 401)
		const response = await fetch(`http://127.0.0.1:${ports.http}/send`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: 'Bearer bridge-token-for-test' },
			body: JSON.stringify({
				from: { name: 'Kent', address: 'kent@kody.test' },
				to: [{ address: 'friend@example.com' }],
				subject: 'Out',
				text: 'outbound body',
				headers: { 'x-kody-tag': 'smoke' },
				attachments: [
					{ filename: 'a.txt', contentType: 'text/plain', contentBase64: Buffer.from('att').toString('base64') },
				],
			}),
		})
		assert.equal(response.status, 202)
		const { messageId } = await response.json()
		assert.match(messageId, /@kody\.test$/)
		await waitFor(() => relayMessages.length > 0)
		const relayed = relayMessages[0]
		assert.equal(relayed.envelope.mailFrom.address, 'kent@kody.test')
		assert.equal(relayed.envelope.rcptTo[0].address, 'friend@example.com')
		assert.match(relayed.raw, new RegExp(`Message-ID: <${messageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`, 'i'))
		assert.match(relayed.raw, /X-Kody-Tag: smoke/i)
		assert.match(relayed.raw, /filename=a\.txt/)
		const event = await waitFor(() => kodyRequests.find((r) => r.url === '/email/events/bridge'))
		const payload = JSON.parse(event.body.toString())
		assert.equal(payload.messageId, messageId)
		assert.equal(payload.event, 'sent')
	})
})

describe('mail bridge shutdown', () => {
	it('refuses new sends and waits for an in-flight delivery before exiting', async (t) => {
		const kody = await eventRecorder()
		let releaseRelay
		const relayHolding = new Promise((resolve) => {
			releaseRelay = resolve
		})
		let relayReceived
		const relayStarted = new Promise((resolve) => {
			relayReceived = resolve
		})
		const relay = new SMTPServer({
			authOptional: true,
			disabledCommands: ['AUTH', 'STARTTLS'],
			onData(stream, _session, callback) {
				stream.resume()
				stream.on('end', async () => {
					relayReceived()
					await relayHolding
					callback(null, 'OK relayed')
				})
			},
		})
		const relayPort = await listen(relay)
		const ports = { kody: kody.port, relay: relayPort, smtp: await freePort(), http: await freePort() }
		const child = spawnBridge(ports, { MAIL_BRIDGE_SEND_TIMEOUT_MS: '20000' })
		t.after(() => {
			releaseRelay()
			child.kill('SIGKILL')
			kody.server.close()
			relay.close()
		})
		await waitFor(async () => (await fetch(`http://127.0.0.1:${ports.http}/health`)).ok)

		const accepted = await postSend(ports.http, 'in flight')
		assert.equal(accepted.status, 202)
		const { messageId } = await accepted.json()
		await relayStarted
		child.kill('SIGTERM')
		await waitFor(async () => (await fetch(`http://127.0.0.1:${ports.http}/health`)).status === 503)

		const refused = await postSend(ports.http, 'after shutdown')
		assert.equal(refused.status, 503)
		assert.deepEqual(await refused.json(), { error: 'shutting_down' })
		assert.equal(kody.events.length, 0)

		releaseRelay()
		assert.equal(await child.exited, 0)
		assert.deepEqual(
			kody.events.map((e) => [e.messageId, e.event]),
			[[messageId, 'sent']],
		)
	})

	it('reports a delivery still sending at the cutoff as failed, then exits', async (t) => {
		// Never finishes its greeting but keeps the socket busy, so only the
		// shutdown cutoff (not an idle timeout) can end the send.
		const sockets = new Set()
		let relayOpenAtReport
		const kody = await eventRecorder(() => {
			relayOpenAtReport = [...sockets].some((socket) => !socket.readableEnded)
		})
		let relayConnected
		const relayStarted = new Promise((resolve) => {
			relayConnected = resolve
		})
		const relay = net.createServer((socket) => {
			sockets.add(socket)
			socket.on('error', () => {})
			const trickle = setInterval(() => socket.write('2'), 100)
			socket.on('close', () => clearInterval(trickle))
			relayConnected()
		})
		const relayPort = await listen(relay)
		const ports = { kody: kody.port, relay: relayPort, smtp: await freePort(), http: await freePort() }
		const child = spawnBridge(ports, { MAIL_BRIDGE_SEND_TIMEOUT_MS: '1000', MAIL_BRIDGE_KODY_TIMEOUT_MS: '2000' })
		t.after(() => {
			child.kill('SIGKILL')
			kody.server.close()
			for (const socket of sockets) socket.destroy()
			relay.close()
		})
		await waitFor(async () => (await fetch(`http://127.0.0.1:${ports.http}/health`)).ok)

		const accepted = await postSend(ports.http, 'stuck')
		assert.equal(accepted.status, 202)
		const { messageId } = await accepted.json()
		await relayStarted
		await new Promise((resolve) => setTimeout(resolve, 1500))
		assert.equal(kody.events.length, 0)
		child.kill('SIGTERM')

		assert.equal(await child.exited, 0)
		assert.equal(kody.events.length, 1)
		assert.equal(kody.events[0].messageId, messageId)
		assert.equal(kody.events[0].event, 'failed')
		assert.match(kody.events[0].detail, /shut down before the relay confirmed delivery/)
		assert.equal(relayOpenAtReport, false, 'relay connection closed before failure was reported')
	})
})

describe('mail bridge relay timeouts', () => {
	it('reports failed when the relay goes silent for MAIL_BRIDGE_SEND_TIMEOUT_MS', async (t) => {
		const kody = await eventRecorder()
		const sockets = new Set()
		const relay = net.createServer((socket) => {
			sockets.add(socket)
			socket.on('error', () => {})
			socket.write('220 silent relay\r\n')
		})
		const relayPort = await listen(relay)
		const ports = { kody: kody.port, relay: relayPort, smtp: await freePort(), http: await freePort() }
		const child = spawnBridge(ports, { MAIL_BRIDGE_SEND_TIMEOUT_MS: '1000' })
		t.after(() => {
			child.kill('SIGKILL')
			kody.server.close()
			for (const socket of sockets) socket.destroy()
			relay.close()
		})
		await waitFor(async () => (await fetch(`http://127.0.0.1:${ports.http}/health`)).ok)

		const accepted = await postSend(ports.http, 'silent relay')
		assert.equal(accepted.status, 202)
		const { messageId } = await accepted.json()
		await waitFor(() => kody.events.length > 0, 5_000)
		assert.equal(kody.events[0].messageId, messageId)
		assert.equal(kody.events[0].event, 'failed')
	})
})
