// Fleet node mode of docker/entrypoint.sh, run with stub `celld` and `sleep`
// binaries on PATH. Issue #193: Docker restarted fenced nodes at once under a
// fresh random session ID, so the dead sessions' logs had no witness left.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import { once } from 'node:events'
import { egressOrigin } from '../src/lib/egress-protocol.ts'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entrypoint = join(here, 'entrypoint.sh')

function runNode(env, args = ['--advertise', 'node-a:9000']) {
	const dir = mkdtempSync(join(tmpdir(), 'kody-entrypoint-'))
	const log = join(dir, 'calls.log')
	writeFileSync(
		join(dir, 'celld'),
		`#!/usr/bin/env bash\necho "celld node=$CELLD_NODE ttl=$CELLD_TTL_MS args=$*" >>"${log}"\n`,
	)
	writeFileSync(join(dir, 'sleep'), `#!/usr/bin/env bash\necho "sleep $*" >>"${log}"\n`)
	chmodSync(join(dir, 'celld'), 0o755)
	chmodSync(join(dir, 'sleep'), 0o755)
	const result = spawnSync('bash', [entrypoint, 'node', ...args], {
		env: { PATH: `${dir}:${process.env.PATH}`, CELLD_BUCKET: 's3://kody-celld', ...env },
		encoding: 'utf8',
	})
	const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
	rmSync(dir, { recursive: true, force: true })
	return { status: result.status, stderr: result.stderr, calls }
}

test('waits one default lease lifetime, then starts celld with that TTL', () => {
	const { status, calls } = runNode({ CELLD_NODE: 'node-a' })
	assert.equal(status, 0)
	assert.deepEqual(calls, ['sleep 10', 'celld node=node-a ttl=10000 args=--advertise node-a:9000'])
})

test('treats an empty CELLD_TTL_MS from compose as the default', () => {
	const { calls } = runNode({ CELLD_NODE: 'node-a', CELLD_TTL_MS: '' })
	assert.deepEqual(calls, ['sleep 10', 'celld node=node-a ttl=10000 args=--advertise node-a:9000'])
})

test('waits the tuned TTL, rounded up to whole seconds, and passes it to celld', () => {
	const { calls } = runNode({ CELLD_NODE: 'node-b', CELLD_TTL_MS: '30500' })
	assert.deepEqual(calls, ['sleep 31', 'celld node=node-b ttl=30500 args=--advertise node-a:9000'])
})

test('refuses to start without a stable CELLD_NODE', () => {
	const { status, stderr, calls } = runNode({})
	assert.equal(status, 64)
	assert.match(stderr, /CELLD_NODE is required/)
	assert.deepEqual(calls, [])
})

test('rejects a CELLD_TTL_MS that is not a positive integer', () => {
	for (const ttl of ['0', '10s', '-1']) {
		const { status, stderr, calls } = runNode({ CELLD_NODE: 'node-a', CELLD_TTL_MS: ttl })
		assert.equal(status, 64, ttl)
		assert.match(stderr, /CELLD_TTL_MS must be a positive integer/)
		assert.deepEqual(calls, [])
	}
})
function readCompose() {
	return readFileSync(join(here, '..', 'compose.fleet.yaml'), 'utf8')
}

test('compose.fleet.yaml gives every node its own stable CELLD_NODE', () => {
	const services = [...readCompose().matchAll(/^ {2}(node-[\w-]+):\n((?: {4}.*\n|\n)*)/gm)].filter(([, , body]) =>
		/^ {4}<<: \*node$/m.test(body),
	)
	assert.ok(services.length >= 2)
	const ids = services.map(([, name, body]) => {
		const id = body.match(/^ {6}CELLD_NODE: (\S+)$/m)?.[1]
		assert.equal(id, name, `${name} sets CELLD_NODE to its service name`)
		assert.match(body, /^ {6}<<: \*node-env$/m, `${name} keeps the shared node env`)
		return id
	})
	assert.equal(new Set(ids).size, ids.length)
})

test('compose.fleet.yaml passes CELLD_TTL_MS through without a second default', () => {
	assert.match(readCompose(), /^ {2}CELLD_TTL_MS: \$\{CELLD_TTL_MS:-\}$/m)
})

test('node startup ignores the obsolete resolver setting with one warning, including an empty value', () => {
	for (const value of ['', 'https://resolver.example/']) {
		const { status, stderr, calls } = runNode({ CELLD_NODE: 'node-a', KODY_DNS_RESOLVER_URL: value })
		assert.equal(status, 0)
		assert.match(stderr, /KODY_DNS_RESOLVER_URL is no longer used.*system resolver.*outbound policy/)
		assert.equal(stderr.match(/KODY_DNS_RESOLVER_URL/g)?.length, 1)
		assert.deepEqual(calls, ['sleep 10', 'celld node=node-a ttl=10000 args=--advertise node-a:9000'])
	}
})

test('the application starts only after the forwarder listens and its exit code is preserved', () => {
	const program = `const response = await fetch('${egressOrigin}/health'); process.exit(response.status === 204 ? 7 : 9)`
	const result = spawnSync(
		process.execPath,
		[join(here, 'with-egress.mjs'), process.execPath, '--input-type=module', '-e', program],
		{
			env: { PATH: process.env.PATH },
			encoding: 'utf8',
			timeout: 10_000,
		},
	)
	assert.equal(result.status, 7, result.stderr)
})

test('a forwarder listener failure stops startup instead of starting the application', async () => {
	const address = new URL(egressOrigin)
	const server = http.createServer()
	server.listen(Number(address.port), address.hostname)
	await once(server, 'listening')
	try {
		const child = spawn(
			process.execPath,
			[join(here, 'with-egress.mjs'), process.execPath, '-e', 'console.log("unexpected application start")'],
			{
				env: { PATH: process.env.PATH },
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		)
		let output = ''
		child.stdout.on('data', (chunk) => {
			output += chunk
		})
		child.stderr.on('data', (chunk) => {
			output += chunk
		})
		const [code] = await once(child, 'exit')
		assert.equal(code, 1)
		assert.match(output, /outbound forwarder failed/)
		assert.doesNotMatch(output, /unexpected application start/)
	} finally {
		await new Promise((resolve) => server.close(resolve))
	}
})

function spawnWrapped(program) {
	const child = spawn(
		process.execPath,
		[join(here, 'with-egress.mjs'), process.execPath, '--input-type=module', '-e', program],
		{
			env: { PATH: process.env.PATH },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	)
	let output = ''
	child.stdout.on('data', (chunk) => {
		output += chunk
	})
	child.stderr.on('data', (chunk) => {
		output += chunk
	})
	const ready = new Promise((resolve) => child.stdout.on('data', () => output.includes('app ready') && resolve()))
	return { child, ready, output: () => output }
}

// Issue #200: the wrapper SIGKILLed celld 5 s after forwarding SIGTERM, cutting
// its shutdown handoff short, and still exited 0.
test('a stop signal waits for a drain longer than 5 s, keeps the forwarder up, and propagates the exit code', async () => {
	const program = [
		"process.on('SIGTERM', () => setTimeout(async () => {",
		`	const response = await fetch('${egressOrigin}/health')`,
		"	console.log('drained')",
		'	process.exit(response.status === 204 ? 3 : 9)',
		'}, 6_000))',
		"console.log('app ready')",
		'setInterval(() => {}, 1_000)',
	].join('\n')
	const { child, ready, output } = spawnWrapped(program)
	await ready
	const started = Date.now()
	child.kill('SIGTERM')
	const [code, signal] = await once(child, 'exit')
	assert.ok(Date.now() - started >= 6_000)
	assert.deepEqual({ code, signal }, { code: 3, signal: null }, output())
	assert.match(output(), /drained/)
})

test('an application killed by a signal is reported as that signal, never as a clean exit', async () => {
	const { child, ready, output } = spawnWrapped("console.log('app ready'); setInterval(() => {}, 1_000)")
	await ready
	child.kill('SIGTERM')
	const [code, signal] = await once(child, 'exit')
	assert.deepEqual({ code, signal }, { code: null, signal: 'SIGTERM' }, output())
})

test('compose gives celld a stop grace above its 40 s shutdown bound', () => {
	assert.match(readFileSync(join(here, '..', 'compose.yaml'), 'utf8'), /^ {4}stop_grace_period: 60s$/m)
	const node = readCompose().split('x-node: &node')[1].split('services:')[0]
	assert.match(node, /^ {2}stop_grace_period: 60s$/m)
})

test('fleet nodes receive the private-host policy at runtime', () => {
	const shared = readCompose().split('x-node-env: &node-env')[1].split('x-node: &node')[0]
	assert.match(shared, /KODY_PRIVATE_HOSTS: \$\{KODY_PRIVATE_HOSTS:-\}/)
})
