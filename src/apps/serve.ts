import type { UserRecord } from '../cells/registry-cell.ts'
import type { Env } from '../env.ts'
import { getUserCell } from '../execute/engine.ts'
import { buildModuleGraph, type ModuleGraph } from '../execute/module-graph.ts'
import { npmConfigFromEnv } from '../execute/npm-config.ts'
import { randomId } from '../lib/crypto.ts'
import { KodyError } from '../lib/errors.ts'
import { limitsFromEnv } from '../lib/limits.ts'
import { isAssetPath, serveAppAsset } from './assets.ts'
import { guardAppBody } from './body-guard.ts'
import { buildAppRequest, sanitizeAppResponse } from './forward.ts'
import type { AppTarget } from './origin.ts'
import { appErrorPage, appNotFoundPage } from './pages.ts'
import { recordAppFailure } from './run-report.ts'
import { appIsolateName, appIsolateNameForGraph, stampsMatch } from './serve-name.ts'
import { mintAppRunToken } from './tokens.ts'

export { appIsolateName }

// Warm requests skip the graph build. An entry is reused only while every saved
// package it pulled in still has the `updated_at` the build read it at, so a
// dependency re-saved mid-build is caught on the next request.
const graphCache = new Map<string, Promise<ModuleGraph>>()
const graphCacheLimit = 32
/** How long after the deadline the wrapper may still report a failure (the RPC is in flight). */
const reportGraceMs = 5_000

async function cachedGraph(
	name: string,
	userCell: ReturnType<typeof getUserCell>,
	build: () => Promise<ModuleGraph>,
): Promise<ModuleGraph> {
	const hit = graphCache.get(name)
	if (hit) {
		try {
			const built = await hit
			const now = await userCell.packageStamps(Object.keys(built.packageStamps))
			if (stampsMatch(built.packageStamps, now) && graphCache.get(name) === hit) {
				// Re-insert so eviction drops the least recently used entry.
				graphCache.delete(name)
				graphCache.set(name, hit)
				return built
			}
		} catch {
			// A failed build or stamp read falls through to a fresh build.
		}
		if (graphCache.get(name) === hit) graphCache.delete(name)
	}
	const graph = build()
	graphCache.set(name, graph)
	graph.catch(() => {
		if (graphCache.get(name) === graph) graphCache.delete(name)
	})
	while (graphCache.size > graphCacheLimit) {
		const oldest = graphCache.keys().next().value
		if (oldest === undefined) break
		graphCache.delete(oldest)
	}
	return graph
}

function errorShape(error: unknown) {
	const kody = KodyError.fromUnknown(error)
	if (kody) return { name: kody.code, message: kody.message }
	if (error instanceof Error) return { name: error.name, message: error.message }
	return { name: 'Error', message: String(error) }
}

const timedOut = Symbol('timeout')

export async function serveApp(input: {
	request: Request
	env: Env
	exports: ExecutionContext['exports']
	/** Keeps a failure record alive that is written after the response was returned (a cut-off body). */
	waitUntil: (promise: Promise<unknown>) => void
	target: AppTarget
	user: UserRecord
}): Promise<Response> {
	const { env, target, user } = input
	const publicUrl = env.KODY_PUBLIC_URL.replace(/\/$/, '')
	const userCell = getUserCell(env, user.id)
	// Only /_assets/* needs the files; page requests read the metadata and build (or reuse) the graph.
	if (isAssetPath(target.restPath)) {
		const saved = await userCell.packageGet(target.packageName)
		const assetApp = saved?.manifest.app
		if (!saved || !assetApp) return appNotFoundPage()
		return serveAppAsset({
			request: input.request,
			restPath: target.restPath,
			files: saved.files,
			assetsDir: assetApp.assets,
		})
	}
	// One deadline covers the graph build, the response headers and the streamed body.
	const limits = limitsFromEnv(env)
	const timeoutMs = limits.executeTimeoutMs
	const deadlineAt = Date.now() + timeoutMs
	let timer: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<typeof timedOut>((resolve) => {
		timer = setTimeout(() => resolve(timedOut), timeoutMs)
	})
	try {
		return await serveAppPage({ ...input, publicUrl, userCell, timeoutMs, deadlineAt, deadline, limits })
	} finally {
		clearTimeout(timer)
	}
}

async function serveAppPage(
	input: Parameters<typeof serveApp>[0] & {
		publicUrl: string
		userCell: ReturnType<typeof getUserCell>
		timeoutMs: number
		deadlineAt: number
		deadline: Promise<typeof timedOut>
		limits: ReturnType<typeof limitsFromEnv>
	},
): Promise<Response> {
	const { env, target, user, publicUrl, userCell, timeoutMs, deadline } = input
	const pkg = await userCell.packageMeta(target.packageName)
	const app = pkg?.manifest.app
	if (!pkg || !app) return appNotFoundPage()
	const hostedUrl = `${target.origin}${target.mountPath}`
	// Every failure of this request records under this id, so it writes at most one run.
	const runId = randomId('app')
	const fail = (error: { name: string; message: string }) =>
		recordAppFailure(env, { userId: user.id, packageName: pkg.name, runId, error })
	const timeoutPage = async (message: string) => {
		await fail({ name: 'app_timeout', message })
		return appErrorPage(504, message, publicUrl)
	}
	const graphKey = await appIsolateName({
		userId: user.id,
		packageName: pkg.name,
		updatedAt: pkg.updatedAt,
		hostedUrl,
	})

	let graph: ModuleGraph
	try {
		const built = await Promise.race([
			cachedGraph(graphKey, userCell, () => {
				const npm = npmConfigFromEnv(env)
				return buildModuleGraph({
					entry: { kind: 'package', packageName: pkg.name, entryPath: app.entry },
					userCell,
					allowNpm: npm.enabled,
					npm: { config: npm, cache: env.NPM_CACHE.get(env.NPM_CACHE.idFromName('npm-cache')) },
					wrapper: 'app',
				})
			}),
			deadline,
		])
		if (built === timedOut) {
			// A build that hangs (an npm fetch that never answers) must not pin every later request.
			graphCache.delete(graphKey)
			return await timeoutPage(`The app could not be built within ${timeoutMs / 1000}s.`)
		}
		graph = built
	} catch (error) {
		const shape = errorShape(error)
		await fail(shape)
		return appErrorPage(500, `The app could not be built: ${shape.message}`, publicUrl)
	}

	const isolateName = await appIsolateNameForGraph({ userId: user.id, hostedUrl, modules: graph.modules })
	// `app: true` is what lets this isolate (and no other) call `appRunReport`.
	const props = { userId: user.id, email: user.email, packageName: pkg.name, app: true }
	const worker = env.LOADER.get(isolateName, () => ({
		compatibilityDate: '2026-01-01',
		compatibilityFlags: ['nodejs_compat'],
		mainModule: graph.mainModule,
		modules: graph.modules,
		env: { KODY: input.exports.RuntimeHost({ props }) },
		globalOutbound: input.exports.FetchGateway({ props }),
	}))
	// The isolate only ever sees this rebuilt request, never the browser's raw one.
	const appRequest = buildAppRequest(input.request, {
		origin: target.origin,
		restPath: target.restPath,
		context: {
			runId,
			// A late report (after the 504 and a short grace) is refused.
			reportToken: await mintAppRunToken(env.KODY_MASTER_KEY, {
				uid: user.id,
				pkg: pkg.name,
				rid: runId,
				exp: input.deadlineAt + reportGraceMs,
			}),
			packageContext: {
				packageName: pkg.name,
				version: pkg.version,
				hostedUrl,
				appBasePath: target.mountPath,
				assetBasePath: `${target.mountPath}/_assets`,
			},
		},
	})

	const pending = worker.getEntrypoint().fetch(appRequest)
	// A rejection after the 504 is already covered by the timeout run.
	pending.catch(() => {})
	let response: Response | typeof timedOut
	try {
		response = await Promise.race([pending, deadline])
	} catch (error) {
		await fail(errorShape(error))
		return appErrorPage(500, 'The app crashed.', publicUrl)
	}
	if (response === timedOut) return await timeoutPage(`The app did not respond within ${timeoutMs / 1000}s.`)
	const sanitized = sanitizeAppResponse(response)
	if (!sanitized.body) return sanitized
	const body = guardAppBody(sanitized.body, {
		deadlineAt: input.deadlineAt,
		timeoutMs,
		maxBytes: input.limits.appResponseMaxBytes,
		onFailure: (error) => input.waitUntil(fail(error)),
	})
	return new Response(body, { status: sanitized.status, statusText: sanitized.statusText, headers: sanitized.headers })
}
