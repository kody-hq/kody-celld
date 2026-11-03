// URL builders mirror hosted Kody; request handlers own method dispatch.
function segment(value: string | number) {
	if (value == null || String(value) === '')
		throw new Error('URL identifiers cannot be empty.')
	return encodeURIComponent(String(value)).replace(/\./g, '%2E')
}

function filePath(value?: string | number | null) {
	if (value == null) return ''
	const parts = String(value).split('/')
	if (parts.some((part) => part === '.' || part === '..'))
		throw new Error('Relative file paths cannot contain dot segments.')
	return '/' + parts.map(encodeURIComponent).join('/')
}

type SearchOptions = { searchParams?: URLSearchParams | Record<string, string> }
function withSearch(path: string, options?: SearchOptions) {
	const search = new URLSearchParams(options?.searchParams).toString()
	return search ? path + '?' + search : path
}

/**
 * Typed route table for every browser-facing URL, mirroring
 * `packages/worker/universal/routes.ts` upstream so ported components can
 * keep calling `routes.<name>.href()`. Keys follow upstream names where the
 * page exists in both projects (`login`, `account`, `accountSecrets`, …) even
 * when the self-hosted path differs (`/signin` vs `/login`), so an upstream
 * diff that touches `routes.login.href()` applies here unchanged.
 */
export const routes = {
	home: {
		href: (_params?: null, options?: SearchOptions) => withSearch('/', options),
	},
	health: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/health', options),
	},
	mcp: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/mcp', options),
	},
	// Sign-in (`/login` upstream). `/setup` only exists while the registry has
	// zero users.
	setup: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/setup', options),
	},
	login: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/signin', options),
	},
	loginLink: {
		href: (params: { token: string | number }, options?: SearchOptions) =>
			withSearch(`/signin/link/${segment(params.token)}`, options),
	},
	logout: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/signout', options),
	},
	account: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account', options),
	},
	accountPassword: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/password', options),
	},
	accountMcpOauthClients: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/clients', options),
	},
	accountApiTokens: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/tokens', options),
	},
	accountSecrets: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/secrets', options),
	},
	accountSecretsApprove: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/secrets/approve', options),
	},
	accountPackages: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/packages', options),
	},
	accountPackageDetail: {
		href: (params: { name: string | number }, options?: SearchOptions) =>
			withSearch(`/account/packages/${segment(params.name)}`, options),
	},
	accountPackageFiles: {
		href: (
			params: { name: string | number; relativePath?: string | number | null },
			options?: SearchOptions,
		) =>
			withSearch(
				`/account/packages/${segment(params.name)}/files${filePath(params.relativePath)}`,
				options,
			),
	},
	// kody-celld: pre-install preview of a remote source in kody's files explorer.
	accountPackagePreviewFiles: {
		href: (
			params: {
				source: string | number
				relativePath?: string | number | null
			},
			options?: SearchOptions,
		) =>
			withSearch(
				`/account/package-preview/${segment(params.source)}/files${filePath(params.relativePath)}`,
				options,
			),
	},
	accountJobs: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/jobs', options),
	},
	accountJobDetail: {
		href: (params: { jobId: string | number }, options?: SearchOptions) =>
			withSearch(`/account/jobs/${segment(params.jobId)}`, options),
	},
	accountWorkflows: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/workflows', options),
	},
	accountMemories: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/memories', options),
	},
	accountMemoryDetail: {
		href: (params: { memoryId: string | number }, options?: SearchOptions) =>
			withSearch(`/account/memories/${segment(params.memoryId)}`, options),
	},
	accountWebhooks: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/webhooks', options),
	},
	accountActivity: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/runs', options),
	},
	accountIntegrations: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/integrations', options),
	},
	accountMcpServers: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/mcp-servers', options),
	},
	accountEmail: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/inbox', options),
	},
	accountEmailMessage: {
		href: (params: { messageId: string | number }, options?: SearchOptions) =>
			withSearch(`/account/inbox/${segment(params.messageId)}`, options),
	},
	accountSessions: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/account/sessions', options),
	},
	// Operator console (`/admin` upstream). The console has its own cookie
	// (KODY_ADMIN_TOKEN), separate from user sessions.
	admin: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/console', options),
	},
	adminLogin: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/console/signin', options),
	},
	adminLogout: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/console/signout', options),
	},
	adminUsers: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/console', options),
	},
	adminUserDetail: {
		href: (params: { userId: string | number }, options?: SearchOptions) =>
			withSearch(`/console/users/${segment(params.userId)}`, options),
	},
	adminAudit: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/console/audit', options),
	},
	adminConfig: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/console/config', options),
	},
	community: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/community', options),
	},
	communityDetail: {
		href: (params: { name: string | number }, options?: SearchOptions) =>
			withSearch(`/community/${segment(params.name)}`, options),
	},
	brandGuide: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/brand-guide', options),
	},
	oauthAuthorize: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/oauth/authorize', options),
	},
	connectOauth: {
		href: (
			params: { userId: string | number; connectId: string | number },
			options?: SearchOptions,
		) =>
			withSearch(
				`/connect/oauth/${segment(params.userId)}/${segment(params.connectId)}`,
				options,
			),
	},
	connectOauthCallback: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/connect/oauth/callback', options),
	},
	connectSecretSet: {
		href: (_params?: null, options?: SearchOptions) =>
			withSearch('/connect/secret-set', options),
	},
}
