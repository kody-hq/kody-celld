/**
 * Gateway events of a package-app request whose run row does not exist yet.
 * App requests write a run only when they fail, often after their outbound
 * fetches; the user cell holds those events here (memory only, bounded) and
 * moves them onto the run when the failure is recorded. A request that
 * succeeds never takes them; they age out.
 */
export class PendingAppGateway<Event> {
	private readonly held = new Map<string, { at: number; events: Array<Event> }>()
	private readonly maxRuns: number
	private readonly maxEvents: number
	private readonly ttlMs: number
	private readonly now: () => number

	constructor(options: { maxRuns?: number; maxEvents?: number; ttlMs?: number; now?: () => number } = {}) {
		this.maxRuns = options.maxRuns ?? 64
		this.maxEvents = options.maxEvents ?? 100
		// Longer than the largest KODY_EXECUTE_TIMEOUT_MS plus the report grace.
		this.ttlMs = options.ttlMs ?? 16 * 60_000
		this.now = options.now ?? Date.now
	}

	/** Returns false for ids that are not app request ids (those events are dropped as before). */
	hold(runId: string, event: Event): boolean {
		if (!runId.startsWith('app_')) return false
		const now = this.now()
		const entry = this.held.get(runId) ?? { at: now, events: [] }
		entry.events.push(event)
		if (entry.events.length > this.maxEvents) entry.events.shift()
		this.held.delete(runId)
		this.held.set(runId, entry)
		while (this.held.size > this.maxRuns) {
			const oldest = this.held.keys().next().value
			if (oldest === undefined) break
			this.held.delete(oldest)
		}
		return true
	}

	take(runId: string): Array<Event> {
		const entry = this.held.get(runId)
		this.held.delete(runId)
		if (!entry || this.now() - entry.at > this.ttlMs) return []
		return entry.events
	}
}
