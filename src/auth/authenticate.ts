import type { UserRecord } from '../cells/registry-cell.ts'
import type { UserCell } from '../cells/user-cell.ts'
import type { Env } from '../env.ts'
import { getUserCell } from '../execute/engine.ts'
import { apiTokenPrefix } from '../lib/api-token-format.ts'
import { oauthPaths } from '../oauth/protocol.ts'

export type Principal = {
	user: UserRecord
	userCell: DurableObjectStub<UserCell>
	/** How the caller proved who they are. */
	via: 'api_token' | 'oauth' | 'kody_api_token'
	/** Registered MCP client name for OAuth callers. */
	clientName: string | null
	/** Present when the caller authenticated with a kody_at_ token. */
	apiTokenId?: string
	/** Present when the caller authenticated with an OAuth access token. */
	oauthClientId?: string
}

export function bearer(request: Request) {
	const header = request.headers.get('authorization') ?? ''
	const match = /^Bearer\s+(.+)$/i.exec(header)
	return match?.[1]?.trim() ?? null
}

/** OAuth access tokens minted by /oauth/token carry this prefix. */
export const oauthAccessTokenPrefix = 'mcpat_'

/**
 * Bearer to principal. Accepts `kc_`, `kody_at_`, and OAuth `mcpat_` tokens.
 * Unknown or expired tokens resolve to null.
 */
export async function authenticateBearer(request: Request, env: Env): Promise<Principal | null> {
	const token = bearer(request)
	if (!token) return null
	const registry = env.REGISTRY.getByName('registry')
	if (token.startsWith(oauthAccessTokenPrefix)) {
		const resolved = await registry.oauthAccessTokenResolve(token)
		if (!resolved) return null
		const userCell = getUserCell(env, resolved.user.id)
		await userCell.init(resolved.user.id)
		return {
			user: resolved.user,
			userCell,
			via: 'oauth',
			clientName: resolved.clientName,
			oauthClientId: resolved.clientId,
		}
	}
	if (token.startsWith(apiTokenPrefix)) {
		const resolved = await registry.apiTokenResolve(token)
		if (!resolved) return null
		const userCell = getUserCell(env, resolved.user.id)
		await userCell.init(resolved.user.id)
		return {
			user: resolved.user,
			userCell,
			via: 'kody_api_token',
			clientName: null,
			apiTokenId: resolved.tokenId,
		}
	}
	const user = await registry.resolveToken(token)
	if (!user) return null
	const userCell = getUserCell(env, user.id)
	await userCell.init(user.id)
	return { user, userCell, via: 'api_token', clientName: null }
}

/**
 * RFC 9728 §5.1 challenge: MCP clients read `resource_metadata` from the 401
 * to discover the authorization server and start the OAuth flow.
 */
export function mcpUnauthorized(env: Env, request: Request, description: string) {
	const error = bearer(request) ? 'invalid_token' : null
	const challenge = [
		'Bearer',
		`realm="kody-celld"`,
		`resource_metadata="${env.KODY_PUBLIC_URL}${oauthPaths.protectedResourceMetadata}"`,
		...(error ? [`error="${error}"`, `error_description="${description.replaceAll('"', "'")}"`] : []),
	]
	return Response.json(
		{ error: error ?? 'unauthorized', message: description },
		{
			status: 401,
			headers: {
				'www-authenticate': `${challenge[0]} ${challenge.slice(1).join(', ')}`,
				'cache-control': 'no-store',
			},
		},
	)
}
