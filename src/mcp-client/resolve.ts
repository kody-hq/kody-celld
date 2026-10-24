import { KodyError } from '../lib/errors.ts'
import { assertResolvedHostAllowed as assertResolved, type DnsMemo } from '../lib/resolved-host-guard.ts'
import type { McpConfig } from './policy.ts'

export type { DnsMemo } from '../lib/resolved-host-guard.ts'

function refuse(message: string) {
	return new KodyError('mcp_host_not_allowed', message, { status: 403 })
}

/** Best-effort resolved-IP check before a hop (see docs/mcp-servers.md for the rebinding limit; tracked in #45). */
export async function assertResolvedHostAllowed(
	url: URL,
	config: McpConfig,
	fetchImpl: typeof fetch,
	memo?: DnsMemo,
): Promise<void> {
	await assertResolved(url, config, { fetch: (input, init) => fetchImpl(input, init), memo, refuse })
}
