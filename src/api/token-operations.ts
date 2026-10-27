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

const tokenListInputSchema: JsonSchema = {
	type: 'object',
	properties: {
		include_inactive: { type: 'boolean', description: 'Include expired and revoked tokens.' },
	},
	additionalProperties: false,
}

const tokenCreateInputSchema: JsonSchema = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 100 },
		scopes: { type: 'array', minItems: 1, items: { type: 'string', enum: [...orgPermissionScopes] } },
		lifetime: { type: 'string', enum: ['short', 'long'] },
		idle_ttl_seconds: { type: 'integer', minimum: 60, maximum: 1209600 },
		max_lifetime_seconds: { type: 'integer', minimum: 60, maximum: 7776000 },
	},
	required: ['name', 'scopes'],
	additionalProperties: false,
}

const tokenIdInputSchema: JsonSchema = {
	type: 'object',
	properties: {
		token_id: { type: 'string', minLength: 1 },
		id: { type: 'string', minLength: 1 },
	},
	required: ['token_id'],
	additionalProperties: false,
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
		description: `Mint a user-bound API token from the official CLI OAuth client. The default name is kody-cli. Other callers receive invalid_request: ${cliLoginDeviceTokenMessage}`,
		inputSchema: deviceInputSchema,
		outputSchema: deviceTokenViewSchema,
		inputKind: 'json',
		readOnly: false,
	},
	tokenList: {
		summary: 'List API tokens',
		description:
			'List this user’s kody_at_ API tokens. Expired and revoked tokens are omitted unless include_inactive is true.',
		inputSchema: tokenListInputSchema,
		outputSchema: {
			type: 'object',
			properties: { tokens: { type: 'array', items: tokenViewSchema } },
			required: ['tokens'],
		},
		inputKind: 'none',
		readOnly: true,
	},
	tokenCreate: {
		summary: 'Create an API token',
		description: 'Create a user-bound kody_at_ API token. Its value is returned once.',
		inputSchema: tokenCreateInputSchema,
		outputSchema: tokenSecretViewSchema,
		inputKind: 'json',
		readOnly: false,
	},
	tokenGet: {
		summary: 'Get an API token',
		description: 'Return one API token by id, including its status and metadata.',
		inputSchema: tokenIdInputSchema,
		outputSchema: tokenViewSchema,
		inputKind: 'none',
		readOnly: true,
	},
	tokenRotate: {
		summary: 'Rotate an API token',
		description: 'Replace an active token value. The old credential stops working immediately.',
		inputSchema: tokenIdInputSchema,
		outputSchema: tokenSecretViewSchema,
		inputKind: 'none',
		readOnly: false,
	},
	tokenRevoke: {
		summary: 'Revoke an API token',
		description: 'Revoke an API token immediately.',
		inputSchema: tokenIdInputSchema,
		outputSchema: {
			type: 'object',
			properties: { id: { type: 'string' }, revoked: { type: 'boolean', enum: [true] } },
			required: ['id', 'revoked'],
		},
		inputKind: 'none',
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

export function requireCliLoginOAuthPrincipal(principal: Principal, officialClientId: string) {
	if (principal.via !== 'oauth' || principal.oauthClientId !== officialClientId) {
		throw new KodyError('invalid_request', cliLoginDeviceTokenMessage)
	}
}

export function requireCurrentApiTokenPrincipal(principal: Principal) {
	if (principal.via !== 'kody_api_token' || !principal.apiTokenId) {
		throw new KodyError('invalid_request', currentApiTokenMessage)
	}
	return principal.apiTokenId
}

export function requireTokenManagementPrincipal(principal: Principal) {
	if (principal.via !== 'oauth' && principal.via !== 'api_token' && principal.via !== 'kody_api_token') {
		throw new KodyError('invalid_request', 'Authentication required.')
	}
	if (principal.via === 'kody_api_token' && !principal.apiTokenId) {
		throw new KodyError('invalid_request', 'API token principal is missing its token id.')
	}
}
