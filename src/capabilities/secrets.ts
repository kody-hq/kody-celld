import { recordAudit } from '../lib/audit.ts'
import { KodyError } from '../lib/errors.ts'
import { buildSecretPlaceholder, type SecretScope } from '../secrets/placeholders.ts'
import { secretApprovalUrl } from '../secrets/usage.ts'
import { defineCapability, defineDomain } from './define.ts'

export const secretsDomain = defineDomain({
	name: 'secrets',
	description:
		'Save and reference user secrets. Values never come back through MCP; use {{secret:name}} placeholders in fetch requests and Kody injects them at the network boundary for approved hosts only.',
})

const scopeSchema = {
	type: 'string',
	enum: ['user', 'package'],
	description: 'user or package. Package-scoped secrets are visible only to that package.',
}

const secretSetScopeSchema = {
	...scopeSchema,
	default: 'user',
	enum: ['user', 'package', 'session'],
	description: 'user (default), package, or session. Session-scoped secrets are unavailable on celld.',
}

const secretSetHostedFieldsSchema = {
	expires_at: {
		type: ['string', 'null'],
		description: 'Only null (no expiry) is supported on celld.',
	},
	provider: {
		type: ['string', 'null'],
		description: 'Only null (no provider) is supported on celld.',
	},
	hosts: {
		type: ['array', 'null'],
		description: "Only null (the account's approved secret hosts) is supported on celld.",
	},
	login_exchange: {
		type: ['object', 'null'],
		description: 'Only null (no login exchange) is supported on celld.',
	},
	kind: {
		type: 'string',
		description: "Only 'secret' (celld's default) is supported on celld.",
	},
	inject: {
		type: ['object', 'null'],
		description: 'Only the default Authorization bearer header injection is supported on celld.',
	},
	placement: {
		type: ['object', 'null'],
		description: 'Only null or all-true placement (injection anywhere) is supported on celld.',
	},
}

const secretNamePattern = /^[a-zA-Z0-9._-]+$/

type SecretSetHostedFields = {
	expires_at?: string | null
	provider?: string | null
	hosts?: Array<string> | null
	login_exchange?: Record<string, unknown> | null
	kind?: string
	inject?: Record<string, unknown> | null
	placement?: Record<string, unknown> | null
}

type SecretSetArgs = {
	name: string
	value: string
	description?: string
	scope?: SecretScope
	packageName?: string
} & SecretSetHostedFields

type SecretSetManyEntry = {
	name: string
	value?: string
	description?: string
	scope?: SecretScope
} & SecretSetHostedFields

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: Array<string>) {
	const actualKeys = Object.keys(value)
	return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isDefaultInject(value: unknown) {
	if (value === undefined || value === null) return true
	if (!isRecord(value) || !hasExactKeys(value, ['kind', 'name', 'format'])) return false
	return (
		value.kind === 'header' &&
		typeof value.name === 'string' &&
		value.name.toLowerCase() === 'authorization' &&
		value.format === 'Bearer {value}'
	)
}

function isDefaultPlacement(value: unknown) {
	if (value === undefined || value === null) return true
	if (!isRecord(value) || !hasExactKeys(value, ['headers', 'query', 'path', 'body'])) return false
	return value.headers === true && value.query === true && value.path === true && value.body === true
}

function assertSupportedSecretFields(fields: object, label: string) {
	const values = fields as Record<string, unknown>
	const supportedFields = [
		{
			name: 'expires_at',
			defaultText: 'no expiry',
			accepts: (value: unknown) => value === undefined || value === null,
		},
		{ name: 'provider', defaultText: 'none', accepts: (value: unknown) => value === undefined || value === null },
		{
			name: 'hosts',
			defaultText: "the account's approved secret hosts",
			accepts: (value: unknown) => value === undefined || value === null,
		},
		{
			name: 'login_exchange',
			defaultText: 'none',
			accepts: (value: unknown) => value === undefined || value === null,
		},
		{ name: 'kind', defaultText: "'secret'", accepts: (value: unknown) => value === undefined || value === 'secret' },
		{
			name: 'inject',
			defaultText: 'the default Authorization bearer header injection',
			accepts: isDefaultInject,
		},
		{ name: 'placement', defaultText: 'injection anywhere', accepts: isDefaultPlacement },
	]
	for (const field of supportedFields) {
		if (!field.accepts(values[field.name])) {
			throw new KodyError(
				'unsupported_secret_field',
				`${label}.${field.name} is not supported on celld yet. Omit it or use celld's default (${field.defaultText}).`,
			)
		}
	}
}

function assertSecretName(name: unknown, capabilityName: string) {
	if (typeof name !== 'string' || !name.trim() || !secretNamePattern.test(name.trim())) {
		throw new KodyError(
			'invalid_secret_name',
			`${capabilityName}.name must contain only letters, digits, ".", "_", and "-".`,
		)
	}
}

function assertSecretScope(scope: SecretScope | undefined) {
	if (scope !== undefined && scope !== 'user' && scope !== 'package' && scope !== 'session') {
		throw new KodyError('invalid_secret_scope', 'scope must be user or package.')
	}
	if (scope === 'session') {
		throw new KodyError(
			'invalid_secret_scope',
			'Session-scoped secrets are not available on celld. Use user or package scope.',
		)
	}
}

export const secretSet = defineCapability<SecretSetArgs>({
	domain: 'secrets',
	name: 'secretSet',
	aliases: ['secretSave'],
	description:
		'Save or rotate a secret by name. Returns metadata and the placeholder to use in requests. Saving a secret does not approve any host: an account admin or the signed-in owner through a /connect/secret-set link must approve destination hosts separately.',
	tags: ['secrets', 'write'],
	keywords: ['api key', 'token', 'credential', 'password', 'store secret', 'placeholder'],
	inputSchema: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'Secret name: letters, digits, ".", "_", "-".' },
			value: { type: 'string', description: 'Secret value. Never echoed back.' },
			description: { type: 'string' },
			scope: secretSetScopeSchema,
			packageName: { type: 'string', description: 'Required when scope is "package".' },
			...secretSetHostedFieldsSchema,
		},
		required: ['name', 'value'],
	},
	example: `import { kody } from 'kody:runtime'
export default async function main({ name, value }) {
  return await kody.secretSet({ name, value })
}`,
	async handler(args, ctx) {
		assertSecretName(args.name, 'secretSet')
		assertSecretScope(args.scope)
		assertSupportedSecretFields(args, 'secretSet')
		const saved = await ctx.userCell.secretSave({
			name: args.name,
			value: args.value,
			description: args.description,
			scope: args.scope,
			packageName: args.packageName ?? (args.scope === 'package' ? (ctx.packageName ?? undefined) : undefined),
		})
		await recordAudit(ctx.env, {
			actor: `user:${ctx.user.id}`,
			action: 'secret.save',
			target: saved.name,
			details: { scope: saved.scope, packageName: saved.packageName, viaPackage: ctx.packageName },
		})
		return {
			...saved,
			placeholder: buildSecretPlaceholder(saved.name, saved.scope === 'user' ? null : saved.scope),
		}
	},
})

export const secretSetMany = defineCapability<{
	secrets: Array<SecretSetManyEntry>
	assertOnly?: boolean
}>({
	domain: 'secrets',
	name: 'secretSetMany',
	description: 'Validate or atomically save multiple secrets. Values are never returned.',
	tags: ['secrets', 'write', 'batch'],
	keywords: ['api key', 'token', 'credential', 'password', 'store secret', 'atomic', 'batch'],
	inputSchema: {
		type: 'object',
		properties: {
			secrets: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						value: { type: 'string' },
						description: { type: 'string' },
						scope: secretSetScopeSchema,
						...secretSetHostedFieldsSchema,
					},
					required: ['name'],
				},
			},
			assertOnly: { type: 'boolean' },
		},
		required: ['secrets'],
	},
	example: `import { kody } from 'kody:runtime'
export default async function main({ secrets }) {
  return await kody.secretSetMany({ secrets })
}`,
	async handler(args, ctx) {
		const assertOnly = args.assertOnly ?? false
		if (!Array.isArray(args.secrets) || args.secrets.length === 0) {
			throw new KodyError('invalid_args', 'secretSetMany.secrets must contain at least one entry.')
		}
		const entries = args.secrets.map((secret, index) => {
			if (!secret || typeof secret !== 'object' || Array.isArray(secret)) {
				throw new KodyError('invalid_args', `secretSetMany.secrets[${index}] must be an object.`)
			}
			const label = `secretSetMany.secrets[${index}]`
			assertSupportedSecretFields(secret, label)
			assertSecretName(secret.name, label)
			if (secret.value !== undefined && (typeof secret.value !== 'string' || secret.value.length === 0)) {
				throw new KodyError('invalid_secret_value', `secretSetMany.secrets[${index}].value must be a non-empty string.`)
			}
			if (!assertOnly && typeof secret.value !== 'string') {
				throw new KodyError(
					'invalid_secret_value',
					`secretSetMany.secrets[${index}].value is required unless assertOnly is true.`,
				)
			}
			if (secret.description !== undefined && typeof secret.description !== 'string') {
				throw new KodyError('invalid_args', `secretSetMany.secrets[${index}].description must be a string.`)
			}
			assertSecretScope(secret.scope)
			const scope = secret.scope ?? 'user'
			const packageName = scope === 'package' ? (ctx.packageName ?? undefined) : undefined
			if (scope === 'package' && !packageName) {
				throw new KodyError('invalid_secret_scope', 'Package-scoped secrets need a package name.')
			}
			return { ...secret, scope, packageName }
		})
		const secretRows = entries.map((secret) => ({
			name: secret.name,
			value: secret.value,
			description: secret.description,
			scope: secret.scope,
			packageName: secret.packageName,
		}))
		if (assertOnly) {
			const validated = await ctx.userCell.secretValidateMany(secretRows)
			return {
				ok: true,
				assertOnly: true,
				secrets: validated.map((secret) => ({
					name: secret.name,
					scope: secret.scope,
					packageName: secret.packageName ?? null,
					description: secret.description ?? null,
					placeholder: buildSecretPlaceholder(secret.name, secret.scope === 'user' ? null : secret.scope),
				})),
			}
		}
		const saved = await ctx.userCell.secretSaveMany(
			secretRows as Array<{
				name: string
				value: string
				description?: string
				scope?: SecretScope
				packageName?: string
			}>,
		)
		for (const secret of saved) {
			await recordAudit(ctx.env, {
				actor: `user:${ctx.user.id}`,
				action: 'secret.save',
				target: secret.name,
				details: { scope: secret.scope, packageName: secret.packageName, viaPackage: ctx.packageName },
			})
		}
		return {
			ok: true,
			assertOnly: false,
			secrets: saved.map((secret) => ({
				...secret,
				placeholder: buildSecretPlaceholder(secret.name, secret.scope === 'user' ? null : secret.scope),
			})),
		}
	},
})

export const secretList = defineCapability<Record<string, never>>({
	domain: 'secrets',
	name: 'secretList',
	description: 'List saved secret names and metadata (never values) plus approved destination hosts.',
	tags: ['secrets', 'read'],
	keywords: ['list secrets', 'which secrets', 'approved hosts'],
	inputSchema: { type: 'object', properties: {} },
	readOnly: true,
	async handler(_args, ctx) {
		const [secrets, hosts] = await Promise.all([ctx.userCell.secretList(), ctx.userCell.secretHostList()])
		return {
			secrets: secrets.map((s) => ({
				...s,
				placeholder: buildSecretPlaceholder(s.name, s.scope === 'user' ? null : s.scope),
			})),
			approvedHosts: hosts,
			approvalNote: `Hosts are approved by an account admin at ${ctx.baseUrl}/admin/users/${ctx.user.id}/secret-hosts or by the signed-in owner through /connect/secret-set, never through MCP or package code.`,
		}
	},
})

export const secretDelete = defineCapability<{ name: string; scope?: SecretScope; packageName?: string }>({
	domain: 'secrets',
	name: 'secretDelete',
	description: 'Delete a saved secret by name.',
	tags: ['secrets', 'write'],
	keywords: ['remove secret', 'delete credential'],
	inputSchema: {
		type: 'object',
		properties: { name: { type: 'string' }, scope: scopeSchema, packageName: { type: 'string' } },
		required: ['name'],
	},
	async handler(args, ctx) {
		const result = await ctx.userCell.secretDelete({
			name: args.name,
			scope: args.scope,
			packageName: args.packageName ?? ctx.packageName ?? undefined,
		})
		await recordAudit(ctx.env, {
			actor: `user:${ctx.user.id}`,
			action: 'secret.delete',
			target: args.name,
			details: { scope: args.scope ?? 'user', viaPackage: ctx.packageName },
		})
		return result
	},
})

export const secretHostList = defineCapability<Record<string, never>>({
	domain: 'secrets',
	name: 'secretHostList',
	description:
		'List destination hosts approved for secret injection by an account admin or through an owner setup link. Read-only: approvals cannot change through MCP.',
	tags: ['secrets', 'read', 'hosts'],
	keywords: ['allowed hosts', 'approved hosts', 'host approval', 'secret_host_not_approved'],
	inputSchema: { type: 'object', properties: {} },
	readOnly: true,
	async handler(_args, ctx) {
		return {
			hosts: await ctx.userCell.secretHostList(),
			approvalUrl: `${ctx.baseUrl}/admin/users/${ctx.user.id}/secret-hosts`,
		}
	},
})

export const secretLock = defineCapability<{ name: string; package_id: string }>({
	domain: 'secrets',
	name: 'secretLock',
	description: 'Check whether a package needs owner approval to use a user secret. This never grants access.',
	tags: ['secrets', 'read', 'packages'],
	keywords: ['lock secret', 'approve package secret access', 'package grant'],
	inputSchema: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'Name of a user-scope secret.' },
			package_id: { type: 'string', description: 'Installed package name requesting access.' },
		},
		required: ['name', 'package_id'],
	},
	readOnly: true,
	async handler(args, ctx) {
		if (typeof args.name !== 'string' || !args.name.trim()) {
			throw new KodyError('invalid_args', 'name is required.')
		}
		if (typeof args.package_id !== 'string' || !args.package_id.trim()) {
			throw new KodyError('invalid_args', 'package_id is required.')
		}
		const name = args.name.trim()
		const packageName = args.package_id.trim()
		const secrets = await ctx.userCell.secretList()
		const namedSecrets = secrets.filter((item) => item.name === name)
		const secret = namedSecrets.find((item) => item.scope === 'user')
		if (!secret && namedSecrets.length === 0) {
			throw new KodyError('secret_not_found', `Unknown secret "${name}".`, { status: 404 })
		}
		if (!secret) {
			throw new KodyError('invalid_secret_scope', 'secretLock only applies to user-scope secrets.')
		}
		if (!(await ctx.userCell.packageGet(packageName))) {
			throw new KodyError('package_not_found', `Package "${packageName}" is not installed.`, { status: 404 })
		}
		const alreadyGranted = secret.allowedPackages.includes(packageName)
		const baseUrl = ctx.env.KODY_PUBLIC_URL.replace(/\/+$/, '')
		const approvalUrl = secretApprovalUrl(ctx.env.KODY_PUBLIC_URL, name, packageName)
		return {
			name,
			scope: 'user',
			allowed_packages: secret.allowedPackages,
			usage_url: `${baseUrl}/account/secrets`,
			status: alreadyGranted ? 'already_granted' : 'approval_required',
			approval_url: approvalUrl,
			message: alreadyGranted
				? `Package "${packageName}" is already allowed to use secret "${name}".`
				: `Ask the account owner to approve this package at ${approvalUrl}. The secret is not granted until the owner allows it.`,
		}
	},
})

export const secretCapabilities = [secretSet, secretSetMany, secretList, secretDelete, secretHostList, secretLock]
