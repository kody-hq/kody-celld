import type { UserRecord } from '../cells/registry-cell.ts'

/**
 * Per-isolate `getUser` cache for package-app requests. Safe because registry
 * `users` rows are insert-only (no email change, no delete). Only the record is
 * cached: the session check (`sessionAlive`) stays live on every request.
 */
export function createUserCache(limit: number) {
	const users = new Map<string, UserRecord>()
	return {
		async get(userId: string, lookup: (userId: string) => Promise<UserRecord | null>) {
			const hit = users.get(userId)
			if (hit) {
				users.delete(userId)
				users.set(userId, hit)
				return hit
			}
			const user = await lookup(userId)
			if (!user) return null
			users.set(userId, user)
			while (users.size > limit) {
				const oldest = users.keys().next().value
				if (oldest === undefined) break
				users.delete(oldest)
			}
			return user
		},
	}
}
