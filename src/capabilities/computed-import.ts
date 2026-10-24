import { buildModuleGraph } from '../execute/module-graph.ts'
import { npmConfigFromEnv } from '../execute/npm-config.ts'
import { runModuleGraph } from '../execute/engine.ts'
import { KodyError } from '../lib/errors.ts'
import { limitsFromEnv } from '../lib/limits.ts'
import { defineCapability } from './define.ts'

export const maxComputedImportDepth = 8

export const packageComputedImport = defineCapability<{
	specifier: string
	params?: unknown
}>({
	domain: 'packages',
	name: 'packageComputedImport',
	description: 'Load a saved package export selected at runtime.',
	tags: ['packages', 'execute'],
	keywords: ['computed import', 'dynamic package import', 'load package export'],
	inputSchema: {
		type: 'object',
		properties: {
			specifier: { type: 'string' },
			params: {},
		},
		required: ['specifier'],
	},
	async handler(args, ctx) {
		const specifier = args.specifier.trim()
		if (!specifier.startsWith('kody:@')) {
			throw new KodyError('invalid_import', 'packageComputedImport requires a kody:@ package specifier.')
		}
		if (ctx.computedImportDepth >= maxComputedImportDepth) {
			throw new KodyError(
				'computed_import_depth_exceeded',
				`Computed kody:@ import exceeded the maximum nested depth (${maxComputedImportDepth}).`,
			)
		}
		const npm = npmConfigFromEnv(ctx.env)
		const graph = await buildModuleGraph({
			entry: {
				kind: 'adhoc',
				code: `import fn from ${JSON.stringify(specifier)}\nexport default async (params) => await fn(params)`,
			},
			userCell: ctx.userCell,
			allowNpm: npm.enabled,
			npm: { config: npm, cache: ctx.env.NPM_CACHE.get(ctx.env.NPM_CACHE.idFromName('npm-cache')) },
		})
		const timeoutMs = ctx.timeoutMs ?? limitsFromEnv(ctx.env).executeTimeoutMs
		const payload = await runModuleGraph(ctx.env, ctx.exports, {
			graph,
			user: ctx.user,
			params: args.params,
			packageName: ctx.packageName,
			runId: ctx.runId,
			eventDepth: ctx.eventDepth,
			computedImportDepth: ctx.computedImportDepth + 1,
			timeoutMs,
		})
		if (!payload.ok) {
			throw new KodyError(payload.error.name, payload.error.message)
		}
		return payload.result
	},
})

export const computedImportCapabilities = [packageComputedImport]
