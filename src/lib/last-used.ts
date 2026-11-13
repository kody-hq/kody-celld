/**
 * Minimum gap between `last_used_at` stamps on one credential, so an
 * authenticated read is not also a storage write. Matches hosted Kody's
 * inbound MCP last-used debounce (packages/worker/src/inbound-mcp-connection-last-used.ts).
 */
export const lastUsedWriteIntervalMs = 5 * 60 * 1000

/** ISO cutoff: a `last_used_at` older than this is due for a fresh stamp at `now`. */
export function lastUsedStaleBefore(now: Date) {
	return new Date(now.getTime() - lastUsedWriteIntervalMs).toISOString()
}
