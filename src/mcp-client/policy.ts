import { KodyError } from '../lib/errors.ts'
import { privateHostsEnvKey, privateHostsFromEnv, type PrivateHostsEnv } from '../lib/private-hosts-env.ts'
import { assertLiteralHostAllowed } from '../lib/resolved-host-guard.ts'

export type McpEnv = PrivateHostsEnv & {
	KODY_MCP_CALL_TIMEOUT_MS?: string
}

export type McpConfig = { allowPrivateHosts: Array<string>; callTimeoutMs: number }

export const defaultMcpCallTimeoutMs = 30_000
export const mcpServerNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function mcpConfigFromEnv(env: McpEnv): McpConfig {
	try {
		const allowPrivateHosts = privateHostsFromEnv(env)
		const raw = env.KODY_MCP_CALL_TIMEOUT_MS?.trim()
		let callTimeoutMs = defaultMcpCallTimeoutMs
		if (raw) {
			callTimeoutMs = Number(raw)
			if (!Number.isInteger(callTimeoutMs) || callTimeoutMs < 1_000 || callTimeoutMs > 600_000) {
				throw new Error(`KODY_MCP_CALL_TIMEOUT_MS: expected an integer between 1000 and 600000, got "${raw}".`)
			}
		}
		return { allowPrivateHosts, callTimeoutMs }
	} catch (error) {
		throw new KodyError('config_error', error instanceof Error ? error.message : String(error), { status: 500 })
	}
}

function refuseMcpHost(message: string) {
	return new KodyError('mcp_host_not_allowed', message, { status: 403 })
}

/** The URL policy for every hop (first URL and each redirect). */
export function assertMcpUrl(raw: string, config: McpConfig): URL {
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw new KodyError('invalid_args', `"${raw}" is not a valid URL.`)
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new KodyError('invalid_args', 'MCP server URLs must use http or https.')
	}
	if (url.username || url.password) {
		throw new KodyError('invalid_args', 'MCP server URLs must not contain credentials; pass bearerToken instead.')
	}
	url.hash = ''
	if (assertLiteralHostAllowed(url, config.allowPrivateHosts, refuseMcpHost)) return url
	const host = url.hostname.toLowerCase()
	if (url.protocol === 'http:') {
		throw new KodyError(
			'mcp_host_not_allowed',
			`Plain http is only allowed for hosts in ${privateHostsEnvKey}; use https for "${host}".`,
			{ status: 403 },
		)
	}
	return url
}

export function assertMcpServerName(name: unknown): string {
	if (typeof name !== 'string' || !mcpServerNamePattern.test(name)) {
		throw new KodyError(
			'invalid_args',
			'MCP server name must be 1-64 lowercase letters, digits or "-", starting and ending with a letter or digit.',
		)
	}
	return name
}

/** Bare token → `Bearer <token>`; `Scheme value` kept; a pasted `Authorization:` header name is stripped. */
export function normalizeBearerToken(raw: unknown): string {
	if (typeof raw !== 'string') throw new KodyError('invalid_args', 'bearerToken must be a string.')
	const value = raw.trim().replace(/^authorization:\s*/i, '')
	if (!value || value.length > 8192 || /[\r\n]/.test(value)) {
		throw new KodyError('invalid_args', 'bearerToken must be 1-8192 characters on one line.')
	}
	return /^[A-Za-z][A-Za-z0-9._~+-]*\s+\S/.test(value) ? value : `Bearer ${value}`
}
