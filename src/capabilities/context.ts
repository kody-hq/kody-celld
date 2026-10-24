import type { Principal } from '../auth/authenticate.ts'
import type { Env } from '../env.ts'
import type { CapabilityContext } from './define.ts'

export function capabilityContext(env: Env, ctx: ExecutionContext, auth: Principal): CapabilityContext {
	return {
		env,
		exports: ctx.exports,
		user: { id: auth.user.id, email: auth.user.email },
		userCell: auth.userCell,
		packageName: null,
		runId: null,
		eventDepth: 0,
		baseUrl: env.KODY_PUBLIC_URL,
		fromRuntime: false,
	}
}
