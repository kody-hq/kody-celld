// Operator settings that scripts/render-fleet-config.mjs copies from the
// environment into wrangler.fleet.jsonc. Anything not matched here never
// reaches fleet nodes, because the rendered config replaces the dev `vars`.

// Runtime limits and quota defaults (docs/operations.md).
const forwardedPrefix =
	/^KODY_(EXECUTE|RUN|APP_RESPONSE|RESPONSE|AUDIT|MCP|QUOTA|AI|SEARCH|VECTOR|QDRANT|BLOB|BROWSER|WEBHOOK|EMAIL|NPM|ESM|PACKAGE|DNS|PRIVATE)_/

const forwardedNames = new Set([
	'KODY_APP_BASE_URL',
	'KODY_SECRET_PROVIDER_TIMEOUT_MS',
	'KODY_SECRET_PROVIDER_CACHE_SECONDS',
])

/**
 * Operator settings to forward from `env`; unset/empty = built-in default.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function forwardedOperatorVars(env) {
	return Object.fromEntries(
		Object.entries(env).filter(
			/** @returns {entry is [string, string]} */
			(entry) => {
				const [name, value] = entry
				return (forwardedPrefix.test(name) || forwardedNames.has(name)) && value !== undefined && value !== ''
			},
		),
	)
}
