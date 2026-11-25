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
let failed = false
let exited = false
const forwardedSignals = ['SIGTERM', 'SIGINT']
// The wrapper only passes stop signals on. celld bounds its own shutdown
// handoff (CELLD_SHUTDOWN_TOTAL_MS) and the supervisor's stop grace (Docker
// stop_grace_period, systemd TimeoutStopSec) is the one hard deadline, so a
// wrapper-side kill could only cut the drain short (#200). The forwarder stays
// up until celld exits because requests it still drains may fetch outbound.
function stop(signal = 'SIGTERM') {
	if (child && child.exitCode == null && child.signalCode == null) child.kill(signal)
	else if (!child) finish(failed ? 1 : 0)
}
function fail(message) {
	console.error(`[kody-celld] ${message}`)
	failed = true
	stop()
}
function finish(code, signal) {
	if (exited) return
	exited = true
	server.closeAllConnections()
	server.close()
	if (failed) process.exitCode = 1
	else if (signal) {
		// Report the child's signal death as our own, never as a clean exit.
		for (const name of forwardedSignals) process.removeAllListeners(name)
		process.kill(process.pid, signal)
	} else process.exitCode = code ?? 1
}
server.on('error', (error) => fail(`outbound forwarder failed: ${error.message}`))
server.on('close', () => {
	if (!exited) fail('outbound forwarder stopped unexpectedly')
})
server.listen(Number(address.port), address.hostname, () => {
	if (exited) return
	console.log('[kody-celld] outbound forwarder ready')
	child = spawn(args[0], args.slice(1), { stdio: 'inherit', env })
	child.on('error', (error) => {
		console.error('[kody-celld] application failed:', error.message)
		failed = true
		if (child.pid == null) finish(1)
	})
	child.on('exit', (code, signal) => finish(code, signal))
})
for (const signal of forwardedSignals) process.on(signal, () => stop(signal))
