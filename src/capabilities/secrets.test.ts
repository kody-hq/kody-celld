import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityContext } from './define.ts'
import { createCapabilityRegistry } from './lookup.ts'
import { secretLock, secretSet, secretSetMany } from './secrets.ts'
import { KodyError } from '../lib/errors.ts'

const runSecretCapability = createCapabilityRegistry([secretSet, secretSetMany, secretLock]).runCapability

function context(userCell: Record<string, unknown>): CapabilityContext {
	return {
		env: {
			KODY_PUBLIC_URL: 'https://kody.example',
			REGISTRY: {
				getByName: () => ({ auditAppend: async (entry: unknown) => entry }),
			},
		} as unknown as CapabilityContext['env'],
		exports: {} as CapabilityContext['exports'],
		user: { id: 'user-1', email: 'person@example.com' },
		userCell: userCell as unknown as CapabilityContext['userCell'],
		packageName: null,
		runId: null,
		eventDepth: 0,
		computedImportDepth: 0,
		baseUrl: 'https://kody.example',
		fromRuntime: false,
	}
}

test('secretSet rejects session scope before calling the cell', async () => {
	let writes = 0
	const ctx = context({
		secretSave: async () => {
			writes++
			return { name: 'token', scope: 'user', packageName: null }
		},
	})
	await assert.rejects(
		runSecretCapability('secretSet', { name: 'token', value: 'value', scope: 'session' }, ctx),
		(error: unknown) =>
			error instanceof KodyError &&
			error.code === 'invalid_secret_scope' &&
			error.message.toLowerCase().includes('session-scoped secrets are not available on celld') &&
			error.message.toLowerCase().includes('use user or package'),
	)
	assert.equal(writes, 0)
})

const unsupportedSecretFields: Array<{ field: string; value: unknown }> = [
	{ field: 'expires_at', value: '2030-01-01' },
	{ field: 'provider', value: 'github' },
	{ field: 'hosts', value: [] },
	{ field: 'login_exchange', value: { url: 'https://api.example.com/token' } },
	{ field: 'kind', value: 'oauth' },
	{ field: 'inject', value: { kind: 'header', name: 'X-Api-Key', format: '{value}' } },
	{ field: 'placement', value: { headers: true, query: false, path: true, body: true } },
]

for (const { field, value } of unsupportedSecretFields) {
	test(`secretSet rejects non-default ${field} before calling the cell`, async () => {
		let writes = 0
		const ctx = context({
			secretSave: async () => {
				writes++
				return { name: 'token', scope: 'user', packageName: null }
			},
		})
		await assert.rejects(
			runSecretCapability('secretSet', { name: 'token', value: 'value', [field]: value }, ctx),
			(error: unknown) =>
				error instanceof KodyError &&
				error.code === 'unsupported_secret_field' &&
				error.message.includes(`secretSet.${field}`),
		)
		assert.equal(writes, 0)
	})
}

test('secretSet accepts no-op hosted field values without passing them to the cell', async () => {
	let received: Record<string, unknown> | undefined
	const ctx = context({
		secretSave: async (input: Record<string, unknown>) => {
			received = input
			return {
				name: input.name,
				scope: input.scope ?? 'user',
				packageName: null,
				description: null,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			}
		},
	})
	const result = await runSecretCapability(
		'secretSet',
		{
			name: 'token',
			value: 'value',
			expires_at: null,
			provider: null,
			hosts: null,
			login_exchange: null,
			kind: 'secret',
			inject: { kind: 'header', name: 'aUtHoRiZaTiOn', format: 'Bearer {value}' },
			placement: { headers: true, query: true, path: true, body: true },
		},
		ctx,
	)
	assert.deepEqual(Object.keys(received ?? {}).sort(), ['description', 'name', 'packageName', 'scope', 'value'])
	assert.equal(Object.hasOwn(result as object, 'warnings'), false)
})

test('secretSetMany validates every entry before saving and assertOnly never saves', async () => {
	let writes = 0
	let validations = 0
	const ctx = context({
		secretValidateMany: async (secrets: Array<Record<string, unknown>>) => {
			validations++
			return secrets
		},
		secretSaveMany: async () => {
			writes++
			return []
		},
	})
	await assert.rejects(
		runSecretCapability(
			'secretSetMany',
			{
				secrets: [
					{ name: 'valid-name', value: 'value' },
					{ name: 'not valid', value: 'value' },
				],
			},
			ctx,
		),
		(error: unknown) => error instanceof KodyError && error.code === 'invalid_secret_name',
	)
	assert.equal(writes, 0)

	const result = await runSecretCapability(
		'secretSetMany',
		{ secrets: [{ name: 'first' }, { name: 'second', scope: 'package' }], assertOnly: true },
		{ ...ctx, packageName: 'my-package' },
	)
	assert.equal(validations, 1)
	assert.equal(writes, 0)
	assert.equal((result as { assertOnly: boolean }).assertOnly, true)
	assert.deepEqual(
		(result as { secrets: Array<{ name: string; placeholder: string }> }).secrets.map((secret) => [
			secret.name,
			secret.placeholder,
		]),
		[
			['first', '{{secret:first}}'],
			['second', '{{secret:second|scope=package}}'],
		],
	)
})

test('secretSetMany rejects non-default expires_at on any entry before validation or writes', async () => {
	for (const assertOnly of [false, true]) {
		let validations = 0
		let writes = 0
		const ctx = context({
			secretValidateMany: async () => {
				validations++
				return []
			},
			secretSaveMany: async () => {
				writes++
				return []
			},
		})
		await assert.rejects(
			runSecretCapability(
				'secretSetMany',
				{
					secrets: [
						{ name: 'valid', value: 'value' },
						{ name: 'unsupported', value: 'value', expires_at: '2030-01-01' },
					],
					assertOnly,
				},
				ctx,
			),
			(error: unknown) =>
				error instanceof KodyError &&
				error.code === 'unsupported_secret_field' &&
				error.message.includes('secretSetMany.secrets[1].expires_at'),
		)
		assert.equal(validations, 0)
		assert.equal(writes, 0)
	}
})

test('secretSetMany returns saved metadata in input order and audits every secret', async () => {
	type AuditInput = { actor: string; action: string; target: string | null; details: Record<string, unknown> | null }
	const audited: Array<AuditInput> = []
	const ctx = context({
		secretSaveMany: async (secrets: Array<Record<string, unknown>>) =>
			secrets.map((secret) => ({
				name: secret.name,
				scope: secret.scope ?? 'user',
				packageName: secret.packageName ?? null,
				description: secret.description ?? null,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			})),
	})
	const registry = (
		ctx.env as unknown as {
			REGISTRY: { getByName: () => { auditAppend: (entry: AuditInput) => Promise<unknown> } }
		}
	).REGISTRY
	registry.getByName = () => ({
		auditAppend: async (entry: AuditInput) => {
			audited.push(entry)
			return entry
		},
	})
	const result = (await runSecretCapability(
		'secretSetMany',
		{
			secrets: [
				{ name: 'second', value: 'value-2' },
				{ name: 'first', value: 'value-1' },
			],
		},
		ctx,
	)) as { secrets: Array<{ name: string; placeholder: string }> }
	assert.equal(Object.hasOwn(result, 'warnings'), false)
	assert.deepEqual(
		result.secrets.map((secret) => [secret.name, secret.placeholder]),
		[
			['second', '{{secret:second}}'],
			['first', '{{secret:first}}'],
		],
	)
	assert.equal(audited.length, 2)
})

test('secretLock reports when owner approval is needed without granting access', async () => {
	let grants = 0
	const ctx = context({
		secretList: async () => [
			{
				name: 'api-key',
				scope: 'user',
				packageName: null,
				description: null,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				allowedPackages: [],
			},
		],
		packageGet: async (name: string) => ({ name }),
		secretUsageGrant: async () => {
			grants++
		},
	})
	const result = (await runSecretCapability('secretLock', { name: 'api-key', package_id: '@example/app' }, ctx)) as {
		status: string
		allowed_packages: Array<string>
		usage_url: string
		approval_url: string
	}
	assert.equal(result.status, 'approval_required')
	assert.deepEqual(result.allowed_packages, [])
	assert.equal(result.usage_url, 'https://kody.example/account/secrets')
	assert.equal(
		result.approval_url,
		'https://kody.example/account/secrets/approve?name=api-key&package=%40example%2Fapp',
	)
	assert.equal(grants, 0)
})

test('secretLock reports an explicit existing grant', async () => {
	const ctx = context({
		secretList: async () => [
			{
				name: 'api-key',
				scope: 'user',
				packageName: null,
				description: null,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				allowedPackages: ['@example/app'],
			},
		],
		packageGet: async (name: string) => ({ name }),
	})
	const result = (await runSecretCapability('secretLock', { name: 'api-key', package_id: '@example/app' }, ctx)) as {
		status: string
		allowed_packages: Array<string>
	}
	assert.equal(result.status, 'already_granted')
	assert.deepEqual(result.allowed_packages, ['@example/app'])
})

test('secretLock distinguishes unknown secrets, packages, and package-scope secrets', async () => {
	const missingSecret = context({
		secretList: async () => [],
		packageGet: async () => ({ name: '@example/app' }),
	})
	await assert.rejects(
		runSecretCapability('secretLock', { name: 'missing', package_id: '@example/app' }, missingSecret),
		(error: unknown) => error instanceof KodyError && error.code === 'secret_not_found',
	)
	const missingPackage = context({
		secretList: async () => [
			{
				name: 'api-key',
				scope: 'user',
				packageName: null,
				allowedPackages: [],
			},
		],
		packageGet: async () => null,
	})
	await assert.rejects(
		runSecretCapability('secretLock', { name: 'api-key', package_id: '@example/app' }, missingPackage),
		(error: unknown) => error instanceof KodyError && error.code === 'package_not_found',
	)
	const packageSecret = context({
		secretList: async () => [
			{
				name: 'api-key',
				scope: 'package',
				packageName: '@example/app',
				allowedPackages: [],
			},
		],
		packageGet: async (name: string) => ({ name }),
	})
	await assert.rejects(
		runSecretCapability('secretLock', { name: 'api-key', package_id: '@example/app' }, packageSecret),
		(error: unknown) => error instanceof KodyError && error.code === 'invalid_secret_scope',
	)
})
