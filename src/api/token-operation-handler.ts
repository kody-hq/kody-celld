import type { Principal } from '../auth/authenticate.ts'
import { orgPermissionScopes } from '../auth/api-token-store.ts'
import type { Env } from '../env.ts'
import { recordAudit } from '../lib/audit.ts'
import { KodyError } from '../lib/errors.ts'
import { cliClientId } from '../oauth/cli-client-metadata.ts'
import { requireCliLoginOAuthPrincipal, requireCurrentApiTokenPrincipal } from './token-operations.ts'

function error(code: string, message: string, status: number) {
	return new KodyError(code, message, { status })
}

export async function handleTokenOperation(
	operationId: string,
	params: Record<string, unknown>,
	env: Env,
	auth: Principal,
) {
	const registry = env.REGISTRY.getByName('registry')
	if (operationId === 'cliLoginDeviceToken') {
		requireCliLoginOAuthPrincipal(auth, cliClientId(env.KODY_PUBLIC_URL))
		if (params.name !== undefined && typeof params.name !== 'string') {
			throw error('invalid_request', 'Invalid parameters.', 400)
		}
		if (params.lifetime !== undefined && typeof params.lifetime !== 'string') {
			throw error('invalid_request', 'Invalid parameters.', 400)
		}
		const idleTtlSeconds =
			params.idle_ttl_seconds === undefined
				? undefined
				: typeof params.idle_ttl_seconds === 'number'
					? params.idle_ttl_seconds
					: Number.NaN
		const maxLifetimeSeconds =
			params.max_lifetime_seconds === undefined
				? undefined
				: typeof params.max_lifetime_seconds === 'number'
					? params.max_lifetime_seconds
					: Number.NaN
		const token = await registry.apiTokenMint({
			userId: auth.user.id,
			name: typeof params.name === 'string' ? params.name.trim() || 'kody-cli' : 'kody-cli',
			lifetime: params.lifetime as string | undefined,
			idleTtlSeconds,
			maxLifetimeSeconds,
			createdVia: 'cli-login',
			scopes: orgPermissionScopes,
		})
		await recordAudit(env, {
			actor: `user:${auth.user.id}`,
			action: 'token.issue',
			target: auth.user.id,
			details: { kind: 'kody_at', tokenId: token.id, createdVia: 'cli-login', name: token.name },
		})
		return Response.json({ ...token, login_org: null }, { headers: { 'Cache-Control': 'no-store' } })
	}
	const tokenId = requireCurrentApiTokenPrincipal(auth)
	if (operationId === 'tokenGetCurrent') {
		const token = await registry.apiTokenGetCurrent(auth.user.id, tokenId)
		if (!token) throw error('not_found', 'The calling API token was not found.', 404)
		return Response.json(token, { headers: { 'Cache-Control': 'no-store' } })
	}
	if (operationId === 'tokenRotateCurrent') {
		const token = await registry.apiTokenRotateCurrent(auth.user.id, tokenId)
		if (!token) throw error('not_found', 'The calling API token was not found.', 404)
		await recordAudit(env, {
			actor: `user:${auth.user.id}`,
			action: 'token.rotate',
			target: tokenId,
			details: { kind: 'kody_at' },
		})
		return Response.json(token, { headers: { 'Cache-Control': 'no-store' } })
	}
	if (operationId === 'tokenRevokeCurrent') {
		if (!(await registry.apiTokenRevokeCurrent(auth.user.id, tokenId))) {
			throw error('not_found', 'The calling API token was not found.', 404)
		}
		await recordAudit(env, {
			actor: `user:${auth.user.id}`,
			action: 'token.revoke',
			target: tokenId,
			details: { kind: 'kody_at' },
		})
		return Response.json({ id: tokenId, revoked: true }, { headers: { 'Cache-Control': 'no-store' } })
	}
	throw error('not_found', 'No route for this API operation.', 404)
}
