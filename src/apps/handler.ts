import type { Env } from '../env.ts'
import type { AppOriginConfig } from './app-url.ts'
import { handleAppOriginRequest } from './origin.ts'
import { serveApp } from './serve.ts'
import { createUserCache } from './user-cache.ts'

const userCache = createUserCache(256)

export async function handleAppOrigin(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	url: URL,
	config: AppOriginConfig,
) {
	const registry = env.REGISTRY.getByName('registry')
	return handleAppOriginRequest(request, url, {
		config,
		masterKey: env.KODY_MASTER_KEY,
		publicUrl: env.KODY_PUBLIC_URL.replace(/\/$/, ''),
		burnHandoff: (jti, expiresAtMs) => registry.appHandoffBurn(jti, expiresAtMs),
		sessionAlive: (userId, sessionId) => registry.sessionAlive(userId, sessionId),
		getUser: (userId) => userCache.get(userId, (id) => registry.getUser(id)),
		serve: (appRequest, target, user) =>
			serveApp({
				request: appRequest,
				env,
				exports: ctx.exports,
				waitUntil: (promise) => ctx.waitUntil(promise),
				target,
				user,
			}),
	})
}
