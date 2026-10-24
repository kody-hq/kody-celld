import { lexImportSpecifiers, relativeImportCandidates } from '../execute/import-specifiers.ts'
import {
	isCodeModulePath,
	jsxOptionsFromFiles,
	stripTypes,
	transpileKind,
	type JsxOptions,
} from '../execute/strip-types.ts'
import { KodyError } from '../lib/errors.ts'
import { listJsonSchemaSubsetProblems, type JsonObject } from '../lib/json-schema-subset.ts'

// Mirrors kody-hq/kody `package.json#kody` shapes for the surfaces this
// runtime supports: exports, jobs, webhooks, subscriptions, emitted events,
// dependencies, description, and hidden.

export type JobSchedule =
	{ type: 'cron'; expression: string } | { type: 'interval'; every: string } | { type: 'once'; runAt: string }

export type JobDefinition = {
	entry: string
	schedule: JobSchedule
	timezone?: string
	enabled?: boolean
	description?: string
}

export type WebhookVerification = {
	type: 'hmac-sha256'
	header: string
	secretName: string
	encoding: 'hex' | 'base64'
	prefix?: string
	signedPayload: 'body' | 'timestamp.body'
}

export type WebhookReplay = {
	timestampHeader?: string
	timestampFormat?: 'unix-seconds' | 'unix-millis' | 'iso' | 'stripe-signature'
	toleranceSeconds?: number
	deliveryIdHeader?: string
}

export type WebhookDefinition = {
	name: string
	/** export name as declared in `exports` (without the leading `./`) */
	export: string
	entry: string
	responseMode: 'ack' | 'sync'
	inputMode: 'request' | 'params'
	rateLimitPerMinute: number
	verification?: WebhookVerification
	replay?: WebhookReplay
	description?: string
}

export type SubscriptionDefinition = {
	topic: string
	handler: string
	description?: string
	filters?: JsonObject
}

export type EmittedEventDefinition = {
	topic: string
	description: string
	payloadSchema?: JsonObject
}

export const credentialKinds = ['secret', 'oauth', 'mcp', 'url', 'login', 'signing'] as const
export type CredentialKind = (typeof credentialKinds)[number]

export type CredentialSlot = {
	kind?: CredentialKind
	provider?: string
	multiple?: boolean
	description: string
}

export const emittedSubscriptionTopics = [
	'email.message.received',
	'email.message.quarantined',
	'email.message.delivery.updated',
	'integration.auth.succeeded',
	'integration.auth.failed',
] as const

export const hostedSubscriptionTopics = [
	'run.error.recorded',
	'mcp.server.disconnected',
	'mcp.server.reconnected',
	'repo.pushed',
	'repo.created',
	'repo.deleted',
	'follow.published',
	'follow.pushed',
	'community.fork.upstream_updated',
	'package.codemod.applied',
	'package.codemod.reverted',
	'credential.created',
	'credential.updated',
	'credential.deleted',
	'credential.rotated',
	'credential.disconnected',
	'package.created',
	'package.updated',
	'package.deleted',
	'package.published',
	'job.created',
	'job.updated',
	'job.deleted',
	'trigger.updated',
	'membership.created',
	'membership.updated',
	'membership.deleted',
	'memory.created',
	'memory.updated',
	'memory.deleted',
] as const

const emittedSubscriptionTopicSet = new Set<string>(emittedSubscriptionTopics)
const hostedSubscriptionTopicSet = new Set<string>(hostedSubscriptionTopics)

/** Export a package must declare to act as a `{{secret/<id>:<ref>}}` provider. */
export const secretProviderExportName = 'secretProvider'
export const secretProviderIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type SecretProviderDefinition = {
	id: string
	entry: string
	description?: string
}

export type SubscriptionTopic = (typeof emittedSubscriptionTopics)[number]

export const webhookNamePattern = /^[a-z0-9][a-z0-9-]*$/
export const webhookDefaultRateLimit = 60
export const webhookMaxRateLimit = 600

/** `package.json#kody.app` (docs/package-apps.md). `client` is recorded, not built, on celld. */
export type AppDefinition = { entry: string; assets: string | null; client: boolean }

export type PackageManifest = {
	name: string
	version: string
	description: string
	/** export name (`.` for the default export) -> normalized relative module path */
	exports: Record<string, string>
	jobs: Record<string, JobDefinition>
	webhooks: Array<WebhookDefinition>
	subscriptions: Array<SubscriptionDefinition>
	emits: Array<EmittedEventDefinition>
	secretProvider: SecretProviderDefinition | null
	app: AppDefinition | null
	credentials: Record<string, CredentialSlot>
	parseWarnings: Array<string>
	dependencies: Record<string, string>
	hidden: boolean
	keywords: Array<string>
}

export type PackageFiles = Record<string, string>

export const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const customPackageEventTopicPattern =
	/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/
const credentialSlotNamePattern = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/

export function normalizeModulePath(path: string) {
	let next = path.trim().replaceAll('\\', '/')
	if (next.startsWith('./')) next = next.slice(2)
	if (next.startsWith('/')) next = next.slice(1)
	const parts: Array<string> = []
	for (const segment of next.split('/')) {
		if (segment === '' || segment === '.') continue
		if (segment === '..') {
			if (parts.length === 0) {
				throw new KodyError('invalid_path', `Path "${path}" escapes the package root.`)
			}
			parts.pop()
			continue
		}
		parts.push(segment)
	}
	if (parts.length === 0) throw new KodyError('invalid_path', `Path "${path}" is empty.`)
	return parts.join('/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSchedule(raw: unknown, jobName: string): JobSchedule {
	if (!isRecord(raw)) {
		throw new KodyError('invalid_manifest', `kody.jobs.${jobName}.schedule must be an object.`)
	}
	if (raw.type === 'cron' && typeof raw.expression === 'string' && raw.expression.trim()) {
		return { type: 'cron', expression: raw.expression.trim() }
	}
	if (raw.type === 'interval' && typeof raw.every === 'string' && raw.every.trim()) {
		return { type: 'interval', every: raw.every.trim() }
	}
	if (raw.type === 'once' && typeof raw.runAt === 'string' && raw.runAt.trim()) {
		return { type: 'once', runAt: raw.runAt.trim() }
	}
	throw new KodyError(
		'invalid_manifest',
		`kody.jobs.${jobName}.schedule must be {type:'cron',expression} | {type:'interval',every} | {type:'once',runAt}.`,
	)
}

function parseWebhookVerification(raw: unknown, name: string): WebhookVerification {
	const where = `kody.webhooks[${name}].verification`
	if (!isRecord(raw)) throw new KodyError('invalid_manifest', `${where} must be an object.`)
	if (raw.type !== 'hmac-sha256') throw new KodyError('invalid_manifest', `${where}.type must be "hmac-sha256".`)
	if (typeof raw.header !== 'string' || !raw.header.trim()) {
		throw new KodyError('invalid_manifest', `${where}.header is required.`)
	}
	if ('secret' in raw || 'secretValue' in raw) {
		throw new KodyError(
			'invalid_manifest',
			`${where} must not carry a secret value; store it with secretSet and reference it via secretName.`,
		)
	}
	if (typeof raw.secretName !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(raw.secretName)) {
		throw new KodyError('invalid_manifest', `${where}.secretName must name a stored secret (never an inline value).`)
	}
	const encoding = raw.encoding ?? 'hex'
	if (encoding !== 'hex' && encoding !== 'base64') {
		throw new KodyError('invalid_manifest', `${where}.encoding must be "hex" or "base64".`)
	}
	const signedPayload = raw.signedPayload ?? 'body'
	if (signedPayload !== 'body' && signedPayload !== 'timestamp.body') {
		throw new KodyError('invalid_manifest', `${where}.signedPayload must be "body" or "timestamp.body".`)
	}
	if (raw.prefix !== undefined && typeof raw.prefix !== 'string') {
		throw new KodyError('invalid_manifest', `${where}.prefix must be a string.`)
	}
	return {
		type: 'hmac-sha256',
		header: raw.header.trim().toLowerCase(),
		secretName: raw.secretName,
		encoding,
		signedPayload,
		...(typeof raw.prefix === 'string' ? { prefix: raw.prefix } : {}),
	}
}

function parseWebhookReplay(raw: unknown, name: string): WebhookReplay {
	const where = `kody.webhooks[${name}].replay`
	if (!isRecord(raw)) throw new KodyError('invalid_manifest', `${where} must be an object.`)
	const replay: WebhookReplay = {}
	if (raw.timestampHeader !== undefined) {
		if (typeof raw.timestampHeader !== 'string' || !raw.timestampHeader.trim()) {
			throw new KodyError('invalid_manifest', `${where}.timestampHeader must be a header name.`)
		}
		replay.timestampHeader = raw.timestampHeader.trim().toLowerCase()
		const format = raw.timestampFormat ?? 'unix-seconds'
		if (!['unix-seconds', 'unix-millis', 'iso', 'stripe-signature'].includes(String(format))) {
			throw new KodyError('invalid_manifest', `${where}.timestampFormat is invalid.`)
		}
		replay.timestampFormat = format as NonNullable<WebhookReplay['timestampFormat']>
		const tolerance = raw.toleranceSeconds ?? 300
		if (typeof tolerance !== 'number' || !Number.isInteger(tolerance) || tolerance < 1 || tolerance > 86_400) {
			throw new KodyError('invalid_manifest', `${where}.toleranceSeconds must be an integer between 1 and 86400.`)
		}
		replay.toleranceSeconds = tolerance
	}
	if (raw.deliveryIdHeader !== undefined) {
		if (typeof raw.deliveryIdHeader !== 'string' || !raw.deliveryIdHeader.trim()) {
			throw new KodyError('invalid_manifest', `${where}.deliveryIdHeader must be a header name.`)
		}
		replay.deliveryIdHeader = raw.deliveryIdHeader.trim().toLowerCase()
	}
	if (replay.timestampHeader === undefined && replay.deliveryIdHeader === undefined) {
		throw new KodyError('invalid_manifest', `${where} needs timestampHeader and/or deliveryIdHeader.`)
	}
	return replay
}

function parseWebhooks(raw: unknown, exports: Record<string, string>): Array<WebhookDefinition> {
	if (raw === undefined) return []
	if (!Array.isArray(raw)) throw new KodyError('invalid_manifest', 'kody.webhooks must be an array.')
	const webhooks: Array<WebhookDefinition> = []
	const seen = new Set<string>()
	for (const item of raw) {
		if (!isRecord(item) || typeof item.name !== 'string') {
			throw new KodyError('invalid_manifest', 'Each kody.webhooks entry needs a string name.')
		}
		const name = item.name
		if (!webhookNamePattern.test(name) || name.length > 64) {
			throw new KodyError('invalid_manifest', `Webhook name "${name}" must be a lowercase slug.`)
		}
		if (seen.has(name)) throw new KodyError('invalid_manifest', `Webhook name "${name}" is declared twice.`)
		seen.add(name)
		if (typeof item.export !== 'string' || item.export === '*') {
			throw new KodyError('invalid_manifest', `kody.webhooks[${name}].export must name one declared export.`)
		}
		const exportName = item.export === '.' ? '.' : item.export.replace(/^\.\//, '')
		const entry = exports[exportName]
		if (!entry) {
			throw new KodyError(
				'invalid_manifest',
				`kody.webhooks[${name}].export "${item.export}" is not in package.json#exports.`,
			)
		}
		const responseMode = item.responseMode ?? 'ack'
		if (responseMode !== 'ack' && responseMode !== 'sync') {
			throw new KodyError('invalid_manifest', `kody.webhooks[${name}].responseMode must be "ack" or "sync".`)
		}
		const inputMode = item.inputMode ?? 'request'
		if (inputMode !== 'request' && inputMode !== 'params') {
			throw new KodyError('invalid_manifest', `kody.webhooks[${name}].inputMode must be "request" or "params".`)
		}
		const rate = item.rateLimitPerMinute ?? webhookDefaultRateLimit
		if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 1 || rate > webhookMaxRateLimit) {
			throw new KodyError(
				'invalid_manifest',
				`kody.webhooks[${name}].rateLimitPerMinute must be an integer between 1 and ${webhookMaxRateLimit}.`,
			)
		}
		const verification = item.verification !== undefined ? parseWebhookVerification(item.verification, name) : undefined
		const replay = item.replay !== undefined ? parseWebhookReplay(item.replay, name) : undefined
		if (verification?.signedPayload === 'timestamp.body' && replay?.timestampHeader === undefined) {
			throw new KodyError(
				'invalid_manifest',
				`kody.webhooks[${name}]: signedPayload "timestamp.body" needs replay.timestampHeader.`,
			)
		}
		webhooks.push({
			name,
			export: exportName,
			entry,
			responseMode,
			inputMode,
			rateLimitPerMinute: rate,
			...(verification ? { verification } : {}),
			...(replay ? { replay } : {}),
			...(typeof item.description === 'string' ? { description: item.description } : {}),
		})
	}
	return webhooks
}

function parseSubscriptions(raw: unknown, files: PackageFiles, warnings: Array<string>): Array<SubscriptionDefinition> {
	if (raw === undefined) return []
	if (!isRecord(raw)) throw new KodyError('invalid_manifest', 'kody.subscriptions must be an object keyed by topic.')
	const subscriptions: Array<SubscriptionDefinition> = []
	for (const [topic, item] of Object.entries(raw)) {
		if (topic.length === 0) throw new KodyError('invalid_manifest', 'kody.subscriptions topic must not be empty.')
		if (!emittedSubscriptionTopicSet.has(topic)) {
			const where = `kody.subscriptions["${topic}"]`
			if (hostedSubscriptionTopicSet.has(topic)) {
				warnings.push(`${where}: celld does not emit this topic yet. The handler is saved but will not run.`)
			} else if (!topic.startsWith('@')) {
				warnings.push(`${where}: unknown topic. The handler is saved but no celld event triggers it.`)
			}
		}
		if (!isRecord(item) || typeof item.handler !== 'string') {
			throw new KodyError('invalid_manifest', `kody.subscriptions["${topic}"].handler is required.`)
		}
		const handler = normalizeModulePath(item.handler)
		if (!(handler in files)) {
			throw new KodyError(
				'invalid_manifest',
				`kody.subscriptions["${topic}"].handler "${handler}" is not in the package files.`,
			)
		}
		if (item.filters !== undefined && !isRecord(item.filters)) {
			throw new KodyError('invalid_manifest', `kody.subscriptions["${topic}"].filters must be a JSON object.`)
		}
		if (item.filters !== undefined && !topic.startsWith('@')) {
			warnings.push(
				`kody.subscriptions["${topic}"].filters is not applied on celld; the handler runs for every event on this topic.`,
			)
		}
		for (const key of Object.keys(item)) {
			if (['handler', 'description', 'filters'].includes(key)) continue
			warnings.push(`kody.subscriptions["${topic}"].${key} is not supported on celld and was dropped.`)
		}
		subscriptions.push({
			topic,
			handler,
			...(typeof item.description === 'string' ? { description: item.description } : {}),
			...(isRecord(item.filters) ? { filters: item.filters as JsonObject } : {}),
		})
	}
	return subscriptions
}

function packageNameScope(name: string): string | null {
	if (!name.startsWith('@')) return null
	const separator = name.indexOf('/')
	if (separator <= 1) return null
	return name.slice(1, separator)
}

function parseEmittedEvents(raw: unknown, packageName: string, warnings: Array<string>): Array<EmittedEventDefinition> {
	if (raw === undefined) return []
	if (!isRecord(raw)) {
		throw new KodyError('invalid_manifest', 'kody.emits must be an object keyed by topic.')
	}
	const expectedScope = packageNameScope(packageName)
	const emittedEvents: Array<EmittedEventDefinition> = []
	for (const [topic, item] of Object.entries(raw)) {
		if (!customPackageEventTopicPattern.test(topic)) {
			throw new KodyError(
				'invalid_manifest',
				`Invalid package.json:\nkody.emits topic "${topic}" must use the scoped form "@scope/topic.name" with a lower-dot-case topic body.`,
			)
		}
		const topicScope = packageNameScope(topic)
		if (expectedScope === null) {
			throw new KodyError(
				'invalid_manifest',
				`Invalid package.json:\nkody.emits topic "${topic}" requires the package name to use a scope.`,
			)
		}
		if (topicScope !== expectedScope) {
			throw new KodyError(
				'invalid_manifest',
				`Invalid package.json:\nkody.emits topic "${topic}" must use the package scope "@${expectedScope}".`,
			)
		}
		if (!isRecord(item)) {
			throw new KodyError('invalid_manifest', `kody.emits["${topic}"] must be an object.`)
		}
		if (typeof item.description !== 'string' || item.description.length === 0) {
			throw new KodyError('invalid_manifest', `kody.emits["${topic}"].description is required.`)
		}
		if (item.payloadSchema !== undefined) {
			if (!isRecord(item.payloadSchema) || item.payloadSchema['type'] !== 'object') {
				throw new KodyError(
					'invalid_manifest',
					`Invalid package.json:\nkody.emits topic "${topic}" payloadSchema must declare "type": "object" (event payloads are JSON objects).`,
				)
			}
			const problems = listJsonSchemaSubsetProblems(item.payloadSchema)
			if (problems.length > 0) {
				throw new KodyError(
					'invalid_manifest',
					`Invalid package.json:\nkody.emits topic "${topic}" payloadSchema is not a supported JSON Schema subset:\n${problems.join('\n')}`,
				)
			}
		}
		if (item.mcp !== undefined && typeof item.mcp !== 'boolean') {
			throw new KodyError('invalid_manifest', `kody.emits["${topic}"].mcp must be a boolean.`)
		}
		if (item.mcp === true) {
			warnings.push(`kody.emits["${topic}"].mcp: MCP Events are not supported on celld; the flag was ignored.`)
		}
		for (const key of Object.keys(item)) {
			if (['description', 'payloadSchema', 'mcp'].includes(key)) continue
			warnings.push(`kody.emits["${topic}"].${key} is not supported on celld and was dropped.`)
		}
		emittedEvents.push({
			topic,
			description: item.description,
			...(isRecord(item.payloadSchema) ? { payloadSchema: item.payloadSchema as JsonObject } : {}),
		})
	}
	return emittedEvents
}

function parseSecretProvider(raw: unknown, exports: Record<string, string>): SecretProviderDefinition | null {
	if (raw === undefined) return null
	if (!isRecord(raw) || typeof raw.id !== 'string') {
		throw new KodyError('invalid_manifest', 'kody.secretProvider must be an object with a string "id".')
	}
	if (!secretProviderIdPattern.test(raw.id)) {
		throw new KodyError(
			'invalid_manifest',
			`kody.secretProvider.id "${raw.id}" is invalid (lowercase letters, digits, ".", "_", "-").`,
		)
	}
	const entry = exports[secretProviderExportName]
	if (!entry) {
		throw new KodyError(
			'invalid_manifest',
			`kody.secretProvider requires an "./${secretProviderExportName}" export in package.json#exports.`,
		)
	}
	return {
		id: raw.id,
		entry,
		...(typeof raw.description === 'string' ? { description: raw.description } : {}),
	}
}

const reservedAssetRoot = /^(?:__version\.json|client\.[0-9a-f]{16}\.js)$/

function parseApp(raw: unknown, files: PackageFiles): AppDefinition | null {
	if (raw === undefined) return null
	if (!isRecord(raw)) throw new KodyError('invalid_manifest', 'kody.app must be an object with an "entry".')
	if (raw.runtime !== undefined) {
		throw new KodyError(
			'invalid_manifest',
			'kody.app.runtime is not supported; kody.app.entry default-exports a fetch handler.',
		)
	}
	if (typeof raw.entry !== 'string') throw new KodyError('invalid_manifest', 'kody.app.entry is required.')
	const entry = normalizeModulePath(raw.entry)
	if (!(entry in files)) {
		throw new KodyError('invalid_manifest', `kody.app.entry "${entry}" is not in the package files.`)
	}
	if (!isCodeModulePath(entry)) {
		throw new KodyError('invalid_manifest', `kody.app.entry "${entry}" is not a JavaScript or TypeScript module.`)
	}
	let assets: string | null = null
	if (raw.assets !== undefined) {
		if (typeof raw.assets !== 'string')
			throw new KodyError('invalid_manifest', 'kody.app.assets must be a directory path.')
		assets = normalizeModulePath(raw.assets)
		const prefix = `${assets}/`
		const inside = Object.keys(files).filter((path) => path.startsWith(prefix))
		if (inside.length === 0) throw new KodyError('invalid_manifest', `kody.app.assets "${assets}" has no files.`)
		const reserved = inside.find((path) => reservedAssetRoot.test(path.slice(prefix.length)))
		if (reserved) {
			throw new KodyError(
				'invalid_manifest',
				`kody.app.assets: "${reserved}" uses a reserved root name (__version.json, client.<hash>.js); nest or rename it.`,
			)
		}
	}
	let client = false
	if (raw.client !== undefined) {
		const clientEntry =
			typeof raw.client === 'string' ? raw.client : isRecord(raw.client) ? raw.client.entry : undefined
		if (typeof clientEntry !== 'string') {
			throw new KodyError('invalid_manifest', 'kody.app.client must be a path or { entry }.')
		}
		const normalized = normalizeModulePath(clientEntry)
		if (!(normalized in files)) {
			throw new KodyError('invalid_manifest', `kody.app.client "${normalized}" is not in the package files.`)
		}
		client = true
	}
	return { entry, assets, client }
}

function parseCredentialSlots(raw: unknown, warnings: Array<string>): Record<string, CredentialSlot> {
	if (raw === undefined) return {}
	if (!isRecord(raw)) throw new KodyError('invalid_manifest', 'kody.credentials must be an object keyed by slot name.')
	const slots: Record<string, CredentialSlot> = {}
	for (const [name, value] of Object.entries(raw)) {
		const where = `kody.credentials.${name}`
		if (!credentialSlotNamePattern.test(name)) {
			throw new KodyError(
				'invalid_manifest',
				`${where}: slot names start with a letter and use letters, numbers, dots, underscores, or hyphens (max 64).`,
			)
		}
		if (!isRecord(value)) throw new KodyError('invalid_manifest', `${where} must be an object.`)
		if (typeof value.description !== 'string' || !value.description.trim() || value.description.trim().length > 500) {
			throw new KodyError('invalid_manifest', `${where}.description is required and must be 1-500 characters.`)
		}
		if (value.kind !== undefined && !(credentialKinds as ReadonlyArray<unknown>).includes(value.kind)) {
			throw new KodyError('invalid_manifest', `${where}.kind must be one of: ${credentialKinds.join(', ')}.`)
		}
		if (value.provider !== undefined) {
			if (typeof value.provider !== 'string' || !value.provider.trim() || value.provider.trim().length > 64) {
				throw new KodyError('invalid_manifest', `${where}.provider must be 1-64 characters.`)
			}
		}
		if (value.multiple !== undefined && typeof value.multiple !== 'boolean') {
			throw new KodyError('invalid_manifest', `${where}.multiple must be a boolean.`)
		}
		if (value.ownerCredentialForVisitors !== undefined && typeof value.ownerCredentialForVisitors !== 'boolean') {
			throw new KodyError('invalid_manifest', `${where}.ownerCredentialForVisitors must be a boolean.`)
		}
		for (const key of Object.keys(value)) {
			if (['kind', 'provider', 'multiple', 'description'].includes(key)) continue
			warnings.push(`${where}.${key} is not supported on celld yet and was dropped.`)
		}
		const kind = value.kind as CredentialKind | undefined
		if (kind === 'url' || kind === 'login' || kind === 'signing') {
			warnings.push(
				`${where}.kind "${kind}" has no celld storage yet; credential() for this need fails with credential_unsupported.`,
			)
		}
		slots[name] = {
			description: value.description.trim(),
			...(kind ? { kind } : {}),
			...(typeof value.provider === 'string' ? { provider: value.provider.trim() } : {}),
			...(typeof value.multiple === 'boolean' ? { multiple: value.multiple } : {}),
		}
	}
	return slots
}

/** Non-fatal notes returned by packageSave. */
export function manifestWarnings(manifest: PackageManifest): Array<string> {
	return [
		...manifest.parseWarnings,
		...(manifest.app?.client
			? ['kody.app.client is not built on kody-celld yet; the app is served server-rendered only.']
			: []),
	]
}

export function normalizeStoredManifest(
	manifest: Partial<PackageManifest> & Pick<PackageManifest, 'name' | 'version'>,
): PackageManifest {
	return {
		name: manifest.name,
		version: manifest.version,
		description: manifest.description ?? '',
		exports: manifest.exports ?? {},
		jobs: manifest.jobs ?? {},
		webhooks: manifest.webhooks ?? [],
		subscriptions: manifest.subscriptions ?? [],
		emits: manifest.emits ?? [],
		secretProvider: manifest.secretProvider ?? null,
		app: manifest.app ?? null,
		credentials: manifest.credentials ?? {},
		parseWarnings: manifest.parseWarnings ?? [],
		dependencies: manifest.dependencies ?? {},
		hidden: manifest.hidden === true,
		keywords: manifest.keywords ?? [],
	}
}

export function parsePackageManifest(files: PackageFiles): PackageManifest {
	const source = files['package.json']
	if (!source) throw new KodyError('invalid_manifest', 'package.json is required.')
	let json: unknown
	try {
		json = JSON.parse(source)
	} catch (error) {
		throw new KodyError('invalid_manifest', `package.json is not valid JSON: ${String(error)}`)
	}
	if (!isRecord(json)) throw new KodyError('invalid_manifest', 'package.json must be an object.')
	const name = json.name
	if (typeof name !== 'string' || !packageNamePattern.test(name)) {
		throw new KodyError('invalid_manifest', 'package.json#name must be an npm-style package name (optionally scoped).')
	}
	const kody = isRecord(json.kody) ? json.kody : {}
	const parseWarnings: Array<string> = []
	const handledKodyKeys = new Set([
		'description',
		'jobs',
		'webhooks',
		'subscriptions',
		'emits',
		'secretProvider',
		'app',
		'credentials',
		'hidden',
		'dependencies',
	])
	const hostedOnlyKodyKeys = new Set(['id', 'tags', 'category', 'searchText', 'secretMounts', 'retrievers'])
	for (const key of Object.keys(kody)) {
		if (handledKodyKeys.has(key)) continue
		if (hostedOnlyKodyKeys.has(key)) {
			parseWarnings.push(`kody.${key} is not supported on celld yet and was ignored.`)
		} else {
			parseWarnings.push(`kody.${key} is not a known manifest key and was ignored.`)
		}
	}

	const exports: Record<string, string> = {}
	if (typeof json.exports === 'string') {
		exports['.'] = normalizeModulePath(json.exports)
	} else if (isRecord(json.exports)) {
		for (const [key, value] of Object.entries(json.exports)) {
			if (typeof value !== 'string') {
				throw new KodyError('invalid_manifest', `exports["${key}"] must be a module path string.`)
			}
			const exportName = key === '.' ? '.' : key.replace(/^\.\//, '')
			exports[exportName] = normalizeModulePath(value)
		}
	} else if (typeof json.main === 'string') {
		exports['.'] = normalizeModulePath(json.main)
	}
	for (const [exportName, path] of Object.entries(exports)) {
		if (!(path in files)) {
			throw new KodyError(
				'invalid_manifest',
				`exports["${exportName}"] points to "${path}" which is not in the package files.`,
			)
		}
	}

	const jobs: Record<string, JobDefinition> = {}
	if (kody.jobs !== undefined) {
		if (!isRecord(kody.jobs)) {
			throw new KodyError('invalid_manifest', 'kody.jobs must be an object keyed by job name.')
		}
		for (const [jobName, raw] of Object.entries(kody.jobs)) {
			if (!/^[a-z0-9][a-z0-9._-]*$/i.test(jobName)) {
				throw new KodyError('invalid_manifest', `Job name "${jobName}" is invalid.`)
			}
			if (!isRecord(raw) || typeof raw.entry !== 'string') {
				throw new KodyError('invalid_manifest', `kody.jobs.${jobName}.entry is required.`)
			}
			const entry = normalizeModulePath(raw.entry)
			if (!(entry in files)) {
				throw new KodyError('invalid_manifest', `kody.jobs.${jobName}.entry "${entry}" is not in the package files.`)
			}
			jobs[jobName] = {
				entry,
				schedule: parseSchedule(raw.schedule, jobName),
				...(typeof raw.timezone === 'string' ? { timezone: raw.timezone } : {}),
				...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
				...(typeof raw.description === 'string' ? { description: raw.description } : {}),
			}
		}
	}

	const dependencies: Record<string, string> = {}
	if (isRecord(kody.dependencies)) {
		for (const [dep, range] of Object.entries(kody.dependencies)) {
			if (!packageNamePattern.test(dep) || typeof range !== 'string') {
				throw new KodyError('invalid_manifest', `kody.dependencies["${dep}"] is invalid.`)
			}
			dependencies[dep] = range
		}
	}

	const readme = files['README.md']?.trim() ?? ''
	const agents = files['AGENTS.md']?.trim() ?? ''
	if (!readme) throw new KodyError('invalid_manifest', 'A non-empty README.md is required.')
	if (!agents) throw new KodyError('invalid_manifest', 'A non-empty AGENTS.md is required.')

	const manifest: PackageManifest = {
		name,
		version: typeof json.version === 'string' ? json.version : '0.0.0',
		description:
			typeof kody.description === 'string'
				? kody.description
				: typeof json.description === 'string'
					? json.description
					: '',
		exports,
		jobs,
		webhooks: parseWebhooks(kody.webhooks, exports),
		subscriptions: parseSubscriptions(kody.subscriptions, files, parseWarnings),
		emits: parseEmittedEvents(kody.emits, name, parseWarnings),
		secretProvider: parseSecretProvider(kody.secretProvider, exports),
		app: parseApp(kody.app, files),
		credentials: parseCredentialSlots(kody.credentials, parseWarnings),
		parseWarnings,
		dependencies,
		hidden: kody.hidden === true,
		keywords: Array.isArray(json.keywords) ? json.keywords.filter((k): k is string => typeof k === 'string') : [],
	}
	assertRelativeImportsResolve(files, [
		...Object.values(manifest.exports),
		...Object.values(manifest.jobs).map((job) => job.entry),
		...manifest.subscriptions.map((subscription) => subscription.handler),
		...(manifest.app ? [manifest.app.entry] : []),
	])
	return manifest
}

/** Resolves `kody:@scope/pkg/export` or `kody:pkg` into package + export name. */
export function parseKodyPackageSpecifier(specifier: string) {
	if (!specifier.startsWith('kody:') || specifier === 'kody:runtime') return null
	const rest = specifier.slice('kody:'.length)
	const segments = rest.split('/')
	let packageName: string
	let exportName: string
	if (rest.startsWith('@')) {
		if (segments.length < 2) return null
		packageName = `${segments[0]}/${segments[1]}`
		exportName = segments.slice(2).join('/') || '.'
	} else {
		packageName = segments[0] ?? ''
		exportName = segments.slice(1).join('/') || '.'
	}
	if (!packageNamePattern.test(packageName)) return null
	return { packageName, exportName }
}

export function resolvePackageExport(manifest: PackageManifest, exportName: string) {
	const key = exportName === '' ? '.' : exportName.replace(/^\.\//, '')
	const path = manifest.exports[key]
	if (!path) {
		throw new KodyError(
			'unknown_export',
			`Package ${manifest.name} has no export "${key}". Available: ${Object.keys(manifest.exports).join(', ') || '(none)'}.`,
			{ status: 404 },
		)
	}
	return path
}

/**
 * TypeScript and JSX are checked as they will run: compiled, so imports used
 * only as types (erased, as tsc and esbuild do) need not resolve. A file
 * sucrase cannot read is skipped here; running it names the compile error.
 * Falling back to the raw source would re-lex broken TSX/JSX and refuse the
 * save with the import lexer's message instead of sucrase's clearer one.
 */
function importSource(path: string, source: string, jsx: JsxOptions): string | null {
	const kind = transpileKind(path)
	if (!kind) return source
	try {
		return stripTypes(source, path, kind, jsx)
	} catch {
		return null
	}
}

/**
 * kody-celld: static relative imports reached from the package's entry points
 * (exports, job entries, subscription handlers) must name a module in the
 * package, using the module graph's lookup (`x`, `x.js`, `.ts` as `.js`,
 * `x/index.js`; code and JSON only). celld links exactly those, so a broken
 * one is refused here instead of failing as `instantiate: <none>` after the
 * next restart. Files nothing reaches (tests, client code), dynamic
 * `import()`s, and imports a compiled TypeScript or JSX file no longer has
 * (`import type`, imports used only as types) are not checked: celld never
 * links them up front, a failed `import()` stays catchable, and type-only
 * imports are erased (kody skips them too). TypeScript and JSX files are
 * checked compiled, as they run. Imports come from the lexer, so text in
 * strings and comments is never checked.
 */
function assertRelativeImportsResolve(files: PackageFiles, entries: Array<string>) {
	const jsx = jsxOptionsFromFiles(files)
	const sources = new Map<string, string>()
	for (const [file, source] of Object.entries(files)) {
		if (isCodeModulePath(file) || file.endsWith('.json')) sources.set(normalizeModulePath(file), source)
	}
	const queue = [...entries]
	const seen = new Set<string>()
	while (queue.length > 0) {
		const path = queue.shift() as string
		if (seen.has(path)) continue
		seen.add(path)
		const source = sources.get(path)
		if (source === undefined || path.endsWith('.json')) continue
		const compiled = importSource(path, source, jsx)
		if (compiled === null) continue
		const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
		for (const { specifier, kind, typeOnly } of lexImportSpecifiers(compiled, path)) {
			if (kind !== 'static' || typeOnly) continue
			if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/')) continue
			let target: string
			try {
				target = normalizeModulePath(base ? `${base}/${specifier}` : specifier)
			} catch {
				throw new KodyError(
					'invalid_import',
					`Cannot resolve "${specifier}" from ${path}: it points outside the package.`,
				)
			}
			const found = relativeImportCandidates(target).find((candidate) => sources.has(candidate))
			if (!found) {
				throw new KodyError(
					'invalid_import',
					`Cannot resolve "${specifier}" from ${path}: no such file in the package.`,
				)
			}
			queue.push(found)
		}
	}
}
