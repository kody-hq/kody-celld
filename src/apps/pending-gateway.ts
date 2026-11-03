const maxRuns = 64
const maxEvents = 100
// Longer than the largest KODY_EXECUTE_TIMEOUT_MS plus the report grace.
const ttlMs = 16 * 60_000

/**
 * Gateway events of a package-app request whose run row does not exist yet.
 * App requests write a run only when they fail, often after their outbound
 * fetches; the user cell holds those events here (memory only, bounded) and
 * moves them onto the run when the failure is recorded. A request that
 * succeeds never takes them; they age out.
 */
export class PendingAppGateway<Event> {
	private readonly held = new Map<string, { at: number; events: Array<Event> }>()
	/** Returns false for ids that are not app request ids (those events are dropped as before). */
	hold(runId: string, event: Event): boolean {
		if (!runId.startsWith('app_')) return false
		const now = Date.now()
		const entry = this.held.get(runId) ?? { at: now, events: [] }
		entry.events.push(event)
		if (entry.events.length > maxEvents) entry.events.shift()
		this.held.delete(runId)
		this.held.set(runId, entry)
		while (this.held.size > maxRuns) {
			const oldest = this.held.keys().next().value
			if (oldest === undefined) break
			this.held.delete(oldest)
		}
		return true
	}

	take(runId: string): Array<Event> {
		const entry = this.held.get(runId)
		this.held.delete(runId)
		if (!entry || Date.now() - entry.at > ttlMs) return []
		return entry.events
	}
}
