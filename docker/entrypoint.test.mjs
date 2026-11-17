// Fleet node mode of docker/entrypoint.sh, run with stub `celld` and `sleep`
// binaries on PATH. Issue #193: Docker restarted fenced nodes at once under a
// fresh random session ID, so the dead sessions' logs had no witness left.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entrypoint = join(here, 'entrypoint.sh')
const dirs = []
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function runNode(env, args = ['--advertise', 'node-a:9000']) {
	const dir = mkdtempSync(join(tmpdir(), 'kody-entrypoint-'))
	dirs.push(dir)
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
	return { status: result.status, stderr: result.stderr, calls }
}

describe('entrypoint node mode', () => {
	it('waits one default lease lifetime, then starts celld with that TTL', () => {
		const { status, calls } = runNode({ CELLD_NODE: 'node-a' })
		assert.equal(status, 0)
		assert.deepEqual(calls, ['sleep 10', 'celld node=node-a ttl=10000 args=--advertise node-a:9000'])
	})

	it('treats an empty CELLD_TTL_MS from compose as the default', () => {
		const { calls } = runNode({ CELLD_NODE: 'node-a', CELLD_TTL_MS: '' })
		assert.deepEqual(calls, ['sleep 10', 'celld node=node-a ttl=10000 args=--advertise node-a:9000'])
	})

	it('waits the tuned TTL, rounded up to whole seconds, and passes it to celld', () => {
		const { calls } = runNode({ CELLD_NODE: 'node-b', CELLD_TTL_MS: '30500' })
		assert.deepEqual(calls, ['sleep 31', 'celld node=node-b ttl=30500 args=--advertise node-a:9000'])
	})

	it('refuses to start without a stable CELLD_NODE', () => {
		const { status, stderr, calls } = runNode({})
		assert.equal(status, 64)
		assert.match(stderr, /CELLD_NODE is required/)
		assert.deepEqual(calls, [])
	})

	it('rejects a CELLD_TTL_MS that is not a positive integer', () => {
		for (const ttl of ['0', '10s', '-1']) {
			const { status, stderr, calls } = runNode({ CELLD_NODE: 'node-a', CELLD_TTL_MS: ttl })
			assert.equal(status, 64, ttl)
			assert.match(stderr, /CELLD_TTL_MS must be a positive integer/)
			assert.deepEqual(calls, [])
		}
	})
})

describe('compose.fleet.yaml', () => {
	const compose = readFileSync(join(here, '..', 'compose.fleet.yaml'), 'utf8')
	const services = [...compose.matchAll(/^ {2}(node-[\w-]+):\n((?: {4}.*\n|\n)*)/gm)].filter(([, , body]) =>
		/^ {4}<<: \*node$/m.test(body),
	)

	it('gives every node its own stable CELLD_NODE', () => {
		assert.ok(services.length >= 2)
		const ids = services.map(([, name, body]) => {
			const id = body.match(/^ {6}CELLD_NODE: (\S+)$/m)?.[1]
			assert.equal(id, name, `${name} sets CELLD_NODE to its service name`)
			assert.match(body, /^ {6}<<: \*node-env$/m, `${name} keeps the shared node env`)
			return id
		})
		assert.equal(new Set(ids).size, ids.length)
	})

	it('passes CELLD_TTL_MS through without a second default', () => {
		assert.match(compose, /^ {2}CELLD_TTL_MS: \$\{CELLD_TTL_MS:-\}$/m)
	})
})
