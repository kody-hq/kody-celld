import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routes } from './routes.ts'

describe('browser URL builders', () => {
	it('keeps self-hosted page and form destinations unchanged', () => {
		const destinations = {
			home: '/',
			health: '/health',
			mcp: '/mcp',
			setup: '/setup',
			login: '/signin',
			logout: '/signout',
			account: '/account',
			accountPassword: '/account/password',
			accountMcpOauthClients: '/account/clients',
			accountApiTokens: '/account/tokens',
			accountSecrets: '/account/secrets',
			accountSecretsApprove: '/account/secrets/approve',
			accountPackages: '/account/packages',
			accountJobs: '/account/jobs',
			accountWorkflows: '/account/workflows',
			accountMemories: '/account/memories',
			accountWebhooks: '/account/webhooks',
			accountActivity: '/account/runs',
			accountIntegrations: '/account/integrations',
			accountMcpServers: '/account/mcp-servers',
			accountEmail: '/account/inbox',
			accountSessions: '/account/sessions',
			admin: '/console',
			adminLogin: '/console/signin',
			adminLogout: '/console/signout',
			adminUsers: '/console',
			adminAudit: '/console/audit',
			adminConfig: '/console/config',
			community: '/community',
			brandGuide: '/brand-guide',
			oauthAuthorize: '/oauth/authorize',
			connectOauthCallback: '/connect/oauth/callback',
			connectSecretSet: '/connect/secret-set',
		} as const
		for (const [key, path] of Object.entries(destinations)) {
			const route = routes[key as keyof typeof destinations]
			assert.equal(route.href(), path, key)
			assert.equal(
				route.href(null, { searchParams: { next: '/account?tab=jobs' } }),
				`${path}?next=%2Faccount%3Ftab%3Djobs`,
				key,
			)
		}
	})

	it('encodes each identifier as one segment without changing route suffixes', () => {
		assert.equal(
			routes.loginLink.href({ token: 'a/b.c' }),
			'/signin/link/a%2Fb%2Ec',
		)
		assert.equal(
			routes.accountPackageDetail.href({ name: '@example/pkg' }),
			'/account/packages/%40example%2Fpkg',
		)
		assert.equal(
			routes.accountJobDetail.href({ jobId: 'pkg#tick' }),
			'/account/jobs/pkg%23tick',
		)
		assert.equal(
			routes.accountMemoryDetail.href({ memoryId: 'a?b' }),
			'/account/memories/a%3Fb',
		)
		assert.equal(
			routes.accountEmailMessage.href({ messageId: 'a%b' }),
			'/account/inbox/a%25b',
		)
		assert.equal(
			routes.adminUserDetail.href({ userId: 42 }),
			'/console/users/42',
		)
		assert.equal(
			routes.communityDetail.href({ name: '@example/pkg' }),
			'/community/%40example%2Fpkg',
		)
		assert.equal(
			routes.connectOauth.href({ userId: 'a/b', connectId: 'c.d' }),
			'/connect/oauth/a%2Fb/c%2Ed',
		)
		assert.equal(
			routes.accountPackageDetail.href({ name: '.' }),
			'/account/packages/%2E',
		)
		assert.throws(
			() => routes.accountPackageDetail.href({ name: '' }),
			/cannot be empty/,
		)
	})

	it('keeps file separators, optional paths, percent signs and empty path segments', () => {
		assert.equal(
			routes.accountPackageFiles.href({
				name: '@example/pkg',
				relativePath: 'src/hello world.js',
			}),
			'/account/packages/%40example%2Fpkg/files/src/hello%20world.js',
		)
		assert.equal(
			routes.accountPackageFiles.href({ name: 'p' }),
			'/account/packages/p/files',
		)
		assert.equal(
			routes.accountPackageFiles.href({ name: 'p', relativePath: null }),
			'/account/packages/p/files',
		)
		assert.equal(
			routes.accountPackageFiles.href({ name: 'p', relativePath: '' }),
			'/account/packages/p/files/',
		)
		assert.equal(
			routes.accountPackagePreviewFiles.href({
				source: 'a/b',
				relativePath: 'docs/100%.txt',
			}),
			'/account/package-preview/a%2Fb/files/docs/100%25.txt',
		)
		assert.equal(
			routes.accountPackageFiles.href({ name: 'p', relativePath: '/x//y/' }),
			'/account/packages/p/files//x//y/',
		)
		for (const relativePath of ['.', '..', 'docs/../x', './x', 'x/./y']) {
			assert.throws(
				() => routes.accountPackageFiles.href({ name: 'p', relativePath }),
				/dot segments/,
			)
			assert.throws(
				() =>
					routes.accountPackagePreviewFiles.href({ source: 's', relativePath }),
				/dot segments/,
			)
		}
	})

	it('preserves repeated search filters and encodes redirects independently', () => {
		assert.equal(
			routes.community.href(null, {
				searchParams: new URLSearchParams([
					['tag', 'a'],
					['tag', 'b'],
					['q', 'a b'],
				]),
			}),
			'/community?tag=a&tag=b&q=a+b',
		)
		assert.equal(
			routes.login.href(null, {
				searchParams: { next: '/account/packages/@example/pkg?tab=files' },
			}),
			'/signin?next=%2Faccount%2Fpackages%2F%40example%2Fpkg%3Ftab%3Dfiles',
		)
		assert.equal(
			routes.accountPackageDetail.href(
				{ name: 'a/b' },
				{ searchParams: { tab: 'read me' } },
			),
			'/account/packages/a%2Fb?tab=read+me',
		)
		assert.equal(
			routes.community.href(null, { searchParams: new URLSearchParams() }),
			'/community',
		)
	})
})
