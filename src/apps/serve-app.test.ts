import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { UserRecord } from '../cells/registry-cell.ts'
import type { Env } from '../env.ts'
import { randomId } from '../lib/crypto.ts'
import { parsePackageManifest, type PackageFiles } from '../packages/manifest.ts'
import { packageFileBytes } from '../packages/package-file-content.ts'
import type { AppTarget } from './origin.ts'
import { appRunIdempotencyKey } from './run-report.ts'
import { serveApp } from './serve.ts'
import { verifyAppRunToken } from './tokens.ts'

const masterKey = 'test-master-key-0123456789abcdef0123456789'

const logoBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])

const appFiles: PackageFiles = {
	'package.json': JSON.stringify({
		name: '@t/app',
		version: '1.0.0',
		exports: { '.': './src/app.js' },
		kody: { app: { entry: 'src/app.js', assets: 'public' } },
	}),
	'README.md': 'app',
	'AGENTS.md': 'app',
	'src/app.js': "import dep from 'kody:@t/dep'\nexport default { fetch: () => new Response(String(dep())) }",
	'public/style.css': 'body { color: red }',
	'public/logo.png': { base64: Buffer.from(logoBytes).toString('base64') },
}

const depFiles: PackageFiles = {
	'package.json': JSON.stringify({ name: '@t/dep', version: '1.0.0', exports: { '.': './index.js' } }),
	'README.md': 'dep',
	'AGENTS.md': 'dep',
	'index.js': 'export default () => 1',
}

type HarnessOptions = {
	/** Runs after the dependency is read. */
	onDepRead?: (store: Store) => void
	/** The app isolate's fetch; defaults to a 200 `page`. */
	appFetch?: (request: Request) => Promise<Response>
	/** The app package's files never arrive, so the graph build hangs. */
	slowBuild?: boolean
	vars?: Record<string, string>
}

/** A user cell and env that count package reads and record runs like the real cell (idempotency included). */
function harness(options: HarnessOptions = {}) {
	const store: Store = {
		'@t/app': { files: appFiles, updatedAt: 'app-1' },
		'@t/dep': { files: depFiles, updatedAt: 'dep-1' },
	}
	const calls = {
		meta: [] as Array<string>,
		get: [] as Array<string>,
		file: [] as Array<string>,
		stamps: 0,
		isolates: 0,
		runs: [] as Array<{ idempotencyKey: string | null; error?: { name: string; message: string } }>,
		props: [] as Array<Record<string, unknown>>,
		contexts: [] as Array<{ runId: string; reportToken: string }>,
	}
	const saved = (name: string) => {
		const entry = store[name]
		if (!entry) return null
		return {
			name,
			version: '1.0.0',
			manifest: parsePackageManifest(entry.files),
			files: entry.files,
			source: 'test',
			createdAt: '',
			updatedAt: entry.updatedAt,
		}
	}
	const userCell = {
		async packageMeta(name: string) {
			calls.meta.push(name)
			const pkg = saved(name)
			if (!pkg) return null
			const { files: _files, ...meta } = pkg
			return meta
		},
		async packageGet(name: string) {
			calls.get.push(name)
			if (options.slowBuild && name === '@t/app') return new Promise<never>(() => {})
			const pkg = saved(name)
			if (name === '@t/dep') options.onDepRead?.(store)
			return pkg
		},
		async packageFileBytes(name: string, path: string) {
			calls.file.push(`${name}:${path}`)
			const content = store[name]?.files[path]
			return content === undefined ? null : packageFileBytes(content)
		},
		async packageStamps(names: Array<string>) {
			calls.stamps++
			return Object.fromEntries(names.flatMap((name) => (store[name] ? [[name, store[name].updatedAt] as const] : [])))
		},
		async runStart(input: { idempotencyKey?: string | null }) {
			const key = input.idempotencyKey ?? null
			const existing = key === null ? undefined : calls.runs.find((run) => run.idempotencyKey === key)
			if (existing) return { run: { id: 'run_existing' }, replayed: true }
			calls.runs.push({ idempotencyKey: key })
			return { run: { id: `run_${calls.runs.length}` }, replayed: false }
		},
		async runFinish(input: { id: string; error?: { name: string; message: string } }) {
			const run = calls.runs[Number(input.id.slice(4)) - 1]
			if (run && input.error) run.error = input.error
		},
	}
	const env = {
		KODY_PUBLIC_URL: 'https://kody.example',
		KODY_MASTER_KEY: masterKey,
		KODY_NPM_IMPORTS: 'off',
		...options.vars,
		USER: { getByName: () => userCell },
		NPM_CACHE: { idFromName: () => 'npm', get: () => ({}) },
		LOADER: {
			get(_name: string, factory: () => unknown) {
				calls.isolates++
				factory()
				const fetch = async (request: Request) => {
					calls.contexts.push(JSON.parse(request.headers.get('x-kody-app-context') ?? '{}'))
					return options.appFetch ? options.appFetch(request) : new Response('page')
				}
				return { getEntrypoint: () => ({ fetch }) }
			},
		},
	} as unknown as Env
	const exports = {
		RuntimeHost: (input: { props: Record<string, unknown> }) => {
			calls.props.push(input.props)
			return {}
		},
		FetchGateway: () => ({}),
	} as unknown as ExecutionContext['exports']
	const pending: Array<Promise<unknown>> = []
	// A fresh user per harness keeps the module-level graph cache from leaking between tests.
	const userId = randomId('user')
	const user: UserRecord = { id: userId, email: 'a@example.com', createdAt: '' }
	const request = (restPath: string) => {
		const target: AppTarget = {
			kind: 'app',
			userId,
			packageName: '@t/app',
			origin: 'https://apps.example',
			mountPath: `/u/${userId}/packages/@t/app`,
			restPath,
		}
		return serveApp({
			request: new Request(`https://apps.example${target.mountPath}${restPath}`),
			env,
			exports,
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
			target,
			user,
		})
	}
	return { store, calls, request, userId, drain: () => Promise.all(pending) }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A body that sends one chunk and then never finishes. */
function stalledBody() {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('<p>loading'))
		},
	})
}

type Store = Record<string, { files: PackageFiles; updatedAt: string }>

describe('serveApp package lookups', () => {
	it('reads only package metadata for a warm page request', async () => {
		const { calls, request } = harness()
		const cold = await request('/')
		assert.equal(cold.status, 200)
		assert.equal(await cold.text(), 'page')
		assert.deepEqual(calls.meta, ['@t/app'])
		// The cold build reads the files of the app and its dependency once each.
		assert.deepEqual(calls.get, ['@t/app', '@t/dep'])

		const warm = await request('/notes')
		assert.equal(warm.status, 200)
		assert.deepEqual(calls.meta, ['@t/app', '@t/app'])
		assert.deepEqual(calls.get, ['@t/app', '@t/dep'], 'a warm page request loads no package files')
	})

	it('reads the metadata and only the requested file for /_assets/*, text or binary', async () => {
		const { calls, request } = harness()
		const response = await request('/_assets/style.css')
		assert.equal(response.status, 200)
		assert.equal(await response.text(), 'body { color: red }')
		const logo = await request('/_assets/logo.png')
		assert.equal(logo.headers.get('content-type'), 'image/png')
		assert.deepEqual(new Uint8Array(await logo.arrayBuffer()), logoBytes)
		assert.deepEqual(calls.get, [])
		assert.deepEqual(calls.meta, ['@t/app', '@t/app'])
		assert.deepEqual(calls.file, ['@t/app:public/style.css', '@t/app:public/logo.png'])
		assert.equal(calls.isolates, 0)
	})

	it('answers not found when the package is not a saved app', async () => {
		const { store, calls, request } = harness()
		delete store['@t/app']
		assert.equal((await request('/')).status, 404)
		assert.deepEqual(calls.get, [])
	})

	it('rebuilds when a dependency is re-saved while the graph is being built', async () => {
		let resaved = false
		const { calls, request } = harness({
			// The dependency is re-saved right after the build read it: the graph holds dep-1 code.
			onDepRead: (store) => {
				if (resaved) return
				resaved = true
				const dep = store['@t/dep']
				if (dep) dep.updatedAt = 'dep-2'
			},
		})
		assert.equal((await request('/')).status, 200)
		assert.deepEqual(calls.get, ['@t/app', '@t/dep'])
		// The cached entry is stamped dep-1 (what the build read), so dep-2 forces a rebuild.
		assert.equal((await request('/')).status, 200)
		assert.deepEqual(calls.get, ['@t/app', '@t/dep', '@t/app', '@t/dep'])
		// Now the stamps match what is saved: warm again.
		assert.equal((await request('/')).status, 200)
		assert.deepEqual(calls.get, ['@t/app', '@t/dep', '@t/app', '@t/dep'])
	})
})

describe('serveApp deadline and failure runs', () => {
	const fast = { KODY_EXECUTE_TIMEOUT_MS: '1000' }

	it('loads the isolate as an app and hands it a run-report token for this request only', async () => {
		const { calls, request, userId } = harness()
		assert.equal((await request('/')).status, 200)
		assert.equal(calls.props[0]?.app, true)
		const context = calls.contexts[0]
		assert.ok(context)
		const claims = await verifyAppRunToken(masterKey, context.reportToken, { uid: userId, pkg: '@t/app' })
		assert.equal(claims?.rid, context.runId)
	})

	it('answers 504 and records one run when the graph build outlives the deadline', async () => {
		const { calls, request } = harness({ slowBuild: true, vars: fast })
		const started = Date.now()
		const response = await request('/')
		assert.equal(response.status, 504)
		assert.ok(Date.now() - started < 3000)
		assert.equal(calls.runs.length, 1)
		assert.equal(calls.runs[0]?.error?.name, 'app_timeout')
		assert.equal(calls.isolates, 0)
		// The hung build is not cached: the next request starts a fresh one.
		assert.equal((await request('/')).status, 504)
		assert.deepEqual(calls.get, ['@t/app', '@t/app'])
	})

	it('errors a streamed body that outlives the deadline and records one run', async () => {
		const { calls, request, drain } = harness({ vars: fast, appFetch: async () => new Response(stalledBody()) })
		const response = await request('/')
		assert.equal(response.status, 200)
		await assert.rejects(response.text(), /did not finish its response within 1s/)
		await drain()
		assert.equal(calls.runs.length, 1)
		assert.equal(calls.runs[0]?.error?.name, 'app_timeout')
		assert.equal(calls.runs[0]?.idempotencyKey, appRunIdempotencyKey(calls.contexts[0]?.runId ?? ''))
	})

	it('errors a body over KODY_APP_RESPONSE_MAX_BYTES and records one run', async () => {
		const { calls, request, drain } = harness({
			vars: { KODY_APP_RESPONSE_MAX_BYTES: '1024' },
			appFetch: async () => new Response('x'.repeat(4096)),
		})
		const response = await request('/')
		await assert.rejects(response.text(), /more than 1024 bytes/)
		await drain()
		assert.equal(calls.runs.length, 1)
		assert.equal(calls.runs[0]?.error?.name, 'app_response_too_large')
	})

	it('records one run when the handler fails after the 504', async () => {
		const { calls, request } = harness({
			vars: fast,
			appFetch: async () => {
				await sleep(1200)
				throw new Error('late failure')
			},
		})
		assert.equal((await request('/')).status, 504)
		await sleep(400)
		assert.equal(calls.runs.length, 1)
		assert.equal(calls.runs[0]?.error?.name, 'app_timeout')
	})
})
