import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { createEgressForwarder } from './egress-forwarder.mjs'
import { egressOrigin } from '../src/lib/egress-protocol.ts'
import { warnUnusedDnsResolverEnv } from '../src/lib/private-hosts-env.ts'

const args = process.argv.slice(2)
let env = process.env
if (args[0] === '--dev') {
	args.shift()
	env = { ...process.env, ...parseEnv(await readFile('.dev.vars', 'utf8')) }
}
if (!args.length) throw new Error('An application command is required.')
warnUnusedDnsResolverEnv(env)
const server = createEgressForwarder(env)
const address = new URL(egressOrigin)
let child
let stopping = false
function stop(code, signal = 'SIGTERM') {
	if (stopping) return
	stopping = true
	process.exitCode = code
	child?.kill(signal)
	if (child) setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
	server.closeAllConnections()
	server.close()
}
server.on('error', (error) => {
	console.error('[kody-celld] outbound forwarder failed:', error.message)
	stop(1)
})
server.on('close', () => {
	if (!stopping) {
		console.error('[kody-celld] outbound forwarder stopped unexpectedly')
		stop(1)
	}
})
server.listen(Number(address.port), address.hostname, () => {
	console.log('[kody-celld] outbound forwarder ready')
	child = spawn(args[0], args.slice(1), { stdio: 'inherit', env })
	child.on('error', (error) => {
		console.error('[kody-celld] application failed:', error.message)
		stop(1)
	})
	child.on('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)))
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(0, signal))
