import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { UserRecord } from '../cells/registry-cell.ts'
import type { Env } from '../env.ts'
import { randomId } from '../lib/crypto.ts'
import { parsePackageManifest, type PackageFiles } from '../packages/manifest.ts'
import type { AppTarget } from './origin.ts'
import { serveApp } from './serve.ts'

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
}

const depFiles: PackageFiles = {
	'package.json': JSON.stringify({ name: '@t/dep', version: '1.0.0', exports: { '.': './index.js' } }),
	'README.md': 'dep',
	'AGENTS.md': 'dep',
	'index.js': 'export default () => 1',
}

/** A user cell and env that count package reads; `onDepRead` runs after the dependency is read. */
function harness(options: { onDepRead?: (store: Store) => void } = {}) {
	const store: Store = {
		'@t/app': { files: appFiles, updatedAt: 'app-1' },
		'@t/dep': { files: depFiles, updatedAt: 'dep-1' },
	}
	const calls = { meta: [] as Array<string>, get: [] as Array<string>, stamps: 0, isolates: 0 }
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
			const pkg = saved(name)
			if (name === '@t/dep') options.onDepRead?.(store)
			return pkg
		},
		async packageStamps(names: Array<string>) {
			calls.stamps++
			return Object.fromEntries(names.flatMap((name) => (store[name] ? [[name, store[name].updatedAt] as const] : [])))
		},
		async runStart() {
			return { run: { id: 'run_1' } }
		},
		async runFinish() {},
	}
	const env = {
		KODY_PUBLIC_URL: 'https://kody.example',
		KODY_NPM_IMPORTS: 'off',
		USER: { getByName: () => userCell },
		NPM_CACHE: { idFromName: () => 'npm', get: () => ({}) },
		LOADER: {
			get(_name: string, factory: () => unknown) {
				calls.isolates++
				factory()
				return { getEntrypoint: () => ({ fetch: async () => new Response('page') }) }
			},
		},
	} as unknown as Env
	const exports = { RuntimeHost: () => ({}), FetchGateway: () => ({}) } as unknown as ExecutionContext['exports']
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
			target,
			user,
		})
	}
	return { store, calls, request }
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

	it('loads the package files for /_assets/* and never reads metadata separately', async () => {
		const { calls, request } = harness()
		const response = await request('/_assets/style.css')
		assert.equal(response.status, 200)
		assert.equal(await response.text(), 'body { color: red }')
		assert.deepEqual(calls.get, ['@t/app'])
		assert.deepEqual(calls.meta, [])
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
