import type { Principal } from '../auth/authenticate.ts'
import type { JsonSchema } from '../capabilities/define.ts'
import { KodyError } from '../lib/errors.ts'
import { orgPermissionScopes } from '../auth/api-token-store.ts'

export const cliLoginDeviceTokenMessage =
	'POST /v1/tokens/device accepts the official CLI login OAuth access token. Send that bearer once; store the returned kody_at_ token.'
export const currentApiTokenMessage =
	'This operation acts on the calling API token, so it is only available over HTTP with Authorization: Bearer kody_at_….'

const tokenViewProperties: Record<string, JsonSchema> = {
	id: { type: 'string' },
	name: { type: 'string' },
	org_id: { type: 'string' },
	org_binding: { type: 'string', enum: ['user'] },
	scopes: { type: 'array', items: { type: 'string', enum: [...orgPermissionScopes] } },
	status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
	idle_ttl_seconds: { type: 'integer' },
	expires_at: { type: 'string' },
	max_expires_at: { type: 'string' },
	created_via: { type: 'string' },
	created_at: { type: 'string' },
	last_used_at: { type: ['string', 'null'] },
	rotated_at: { type: ['string', 'null'] },
	revoked_at: { type: ['string', 'null'] },
	profile_name: { type: ['string', 'null'] },
}

const tokenViewSchema: JsonSchema = {
	type: 'object',
	properties: tokenViewProperties,
	required: Object.keys(tokenViewProperties),
}

const tokenSecretViewProperties: Record<string, JsonSchema> = {
	...tokenViewProperties,
	token: { type: 'string' },
	token_type: { type: 'string', enum: ['Bearer'] },
}

const tokenSecretViewSchema: JsonSchema = {
	type: 'object',
	properties: tokenSecretViewProperties,
	required: Object.keys(tokenSecretViewProperties),
}

const deviceTokenViewSchema: JsonSchema = {
	type: 'object',
	properties: { ...tokenSecretViewProperties, login_org: { type: 'null' } },
	required: [...Object.keys(tokenSecretViewProperties), 'login_org'],
}

const emptyInputSchema: JsonSchema = { type: 'object', properties: {}, additionalProperties: false }

const deviceInputSchema: JsonSchema = {
	type: 'object',
	properties: {
		lifetime: { type: 'string', enum: ['short', 'long'] },
		idle_ttl_seconds: {
			type: 'integer',
			minimum: 60,
			maximum: 1209600,
		},
		max_lifetime_seconds: {
			type: 'integer',
			minimum: 60,
			maximum: 7776000,
		},
		name: { type: 'string', maxLength: 100 },
	},
}

export const tokenApiOperations: Record<
	string,
	{
		summary: string
		description: string
		inputSchema: JsonSchema
		outputSchema: JsonSchema
		inputKind: 'json' | 'none'
		readOnly: boolean
	}
> = {
	cliLoginDeviceToken: {
		summary: 'Create a CLI login token',
		description: `Mint a user-bound API token from an OAuth access token. The default name is kody-cli. Non-OAuth callers receive invalid_request: ${cliLoginDeviceTokenMessage}`,
		inputSchema: deviceInputSchema,
		outputSchema: deviceTokenViewSchema,
		inputKind: 'json',
		readOnly: false,
	},
	tokenGetCurrent: {
		summary: 'Describe the calling token',
		description: `Return metadata for the calling API token. Non-kody_at_ callers receive invalid_request: ${currentApiTokenMessage}`,
		inputSchema: emptyInputSchema,
		outputSchema: tokenViewSchema,
		inputKind: 'none',
		readOnly: true,
	},
	tokenRotateCurrent: {
		summary: 'Rotate the calling token',
		description: `Replace the calling token value. The old value stops working immediately; scopes and max_expires_at are unchanged. Non-kody_at_ callers receive invalid_request: ${currentApiTokenMessage}`,
		inputSchema: emptyInputSchema,
		outputSchema: tokenSecretViewSchema,
		inputKind: 'none',
		readOnly: false,
	},
	tokenRevokeCurrent: {
		summary: 'Revoke the calling token',
		description: `Revoke the calling token immediately. Non-kody_at_ callers receive invalid_request: ${currentApiTokenMessage}`,
		inputSchema: emptyInputSchema,
		outputSchema: {
			type: 'object',
			properties: { id: { type: 'string' }, revoked: { type: 'boolean' } },
			required: ['id', 'revoked'],
		},
		inputKind: 'none',
		readOnly: false,
	},
}

export function requireCliLoginOAuthPrincipal(principal: Principal) {
	if (principal.via !== 'oauth') {
		throw new KodyError('invalid_request', cliLoginDeviceTokenMessage)
	}
}

export function requireCurrentApiTokenPrincipal(principal: Principal) {
	if (principal.via !== 'kody_api_token' || !principal.apiTokenId) {
		throw new KodyError('invalid_request', currentApiTokenMessage)
	}
	return principal.apiTokenId
}
