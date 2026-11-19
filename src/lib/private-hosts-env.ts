import { parseHostAllowlist } from './host-allowlist.ts'

/** Single operator allowlist for private/LAN hosts (MCP, browser, packages, insecure secret HTTP). */
export const privateHostsEnvKey = 'KODY_PRIVATE_HOSTS'

/**
 * Removed in favour of {@link privateHostsEnvKey}. Presence (even empty) fails at
 * config load — see https://github.com/kody-hq/kody-celld/issues/62.
 */
export const removedPrivateHostEnvKeys = [
	'KODY_MCP_ALLOW_PRIVATE_HOSTS',
	'KODY_BROWSER_ALLOW_PRIVATE_HOSTS',
	'KODY_PACKAGE_SOURCE_HOSTS',
	'KODY_ALLOW_INSECURE_SECRET_HOSTS',
] as const

export type PrivateHostsEnv = {
	KODY_PRIVATE_HOSTS?: string
	KODY_DNS_RESOLVER_URL?: string
	KODY_MCP_ALLOW_PRIVATE_HOSTS?: string
	KODY_BROWSER_ALLOW_PRIVATE_HOSTS?: string
	KODY_PACKAGE_SOURCE_HOSTS?: string
	KODY_ALLOW_INSECURE_SECRET_HOSTS?: string
}

const noticeUrl = 'https://github.com/kody-hq/kody-celld/issues/62'

/** Fail loudly when any removed allowlist variable is still set. */
export function assertNoRemovedPrivateHostEnv(env: PrivateHostsEnv): void {
	for (const key of removedPrivateHostEnvKeys) {
		if (env[key] !== undefined) {
			throw new Error(`${key} was removed; set ${privateHostsEnvKey} instead (see ${noticeUrl}).`)
		}
	}
}

export function warnUnusedDnsResolverEnv(env: PrivateHostsEnv): void {
	if (env.KODY_DNS_RESOLVER_URL !== undefined) {
		console.warn(
			'[kody-celld] KODY_DNS_RESOLVER_URL is no longer used and is ignored; the system resolver is used for outbound policy.',
		)
	}
}

/** Parse `KODY_PRIVATE_HOSTS`, refusing any of the removed variable names. */
export function privateHostsFromEnv(env: PrivateHostsEnv): Array<string> {
	assertNoRemovedPrivateHostEnv(env)
	return parseHostAllowlist(env.KODY_PRIVATE_HOSTS, privateHostsEnvKey)
}
