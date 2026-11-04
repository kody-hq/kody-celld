import { type Handle } from 'remix/component'
import { type AppLoaderData } from '#universal/loader-data.ts'
import { AccountActivity } from './account-activity.tsx'
import { AccountEmail } from './account-email.tsx'
import { AccountIntegrations } from './account-integrations.tsx'
import { AccountJobs } from './account-jobs.tsx'
import { AccountWorkflows } from './account-workflows.tsx'
import { AccountJobDetail } from './account-jobs-detail.tsx'
import { AccountMemories } from './account-memories.tsx'
import { AccountMcpServerAuthorize } from './account-mcp-server-authorize.tsx'
import { AccountMcpServers } from './account-mcp-servers.tsx'
import { AccountPackages } from './account-packages.tsx'
import { AccountPackageDetail } from './account-package-detail.tsx'
import { AccountWebhooks } from './account-webhooks.tsx'
import { ErrorPage } from './error-page.tsx'
import { PackageFiles } from './package-files.tsx'
import { PackagePreviewFiles } from './package-preview-files.tsx'

/**
 * Server-side page dispatch: the handler decides which `AppLoaderData`
 * variant a request yields, and this picks the route component. kody does
 * the same in `client/routes.tsx` with its client router; here every page
 * is a full document, so the switch is the whole router.
 */
export function RouteView(
	handle: Handle<{ data: AppLoaderData; pathname: string; signedIn: boolean }>,
) {
	return () => {
		const { data, pathname } = handle.props
		switch (data.page) {
			case 'error':
				return <ErrorPage data={data} signedIn={handle.props.signedIn} />
			case 'accountPackages':
				return <AccountPackages data={data} pathname={pathname} />
			case 'accountPackageDetail':
				return <AccountPackageDetail data={data} pathname={pathname} />
			case 'accountPackageFiles':
				return <PackageFiles data={data} pathname={pathname} />
			case 'accountPackagePreviewFiles':
				return <PackagePreviewFiles data={data} pathname={pathname} />
			case 'accountJobs':
				return <AccountJobs data={data} pathname={pathname} />
			case 'accountWorkflows':
				return <AccountWorkflows data={data} pathname={pathname} />
			case 'accountJobDetail':
				return <AccountJobDetail data={data} pathname={pathname} />
			case 'accountMemories':
				return <AccountMemories data={data} pathname={pathname} />
			case 'accountWebhooks':
				return <AccountWebhooks data={data} pathname={pathname} />
			case 'accountActivity':
				return <AccountActivity data={data} pathname={pathname} />
			case 'accountIntegrations':
				return <AccountIntegrations data={data} pathname={pathname} />
			case 'accountMcpServers':
				return <AccountMcpServers data={data} pathname={pathname} />
			case 'accountMcpServerAuthorize':
				return <AccountMcpServerAuthorize data={data} pathname={pathname} />
			case 'accountEmail':
				return <AccountEmail data={data} pathname={pathname} />
			case 'account':
			case 'accountSessions':
			case 'accountApiTokens':
			case 'accountMcpOauthClients':
			case 'accountSecrets':
			case 'accountSecretApprove':
				throw new Error(
					'Migrated account pages require the Start document renderer',
				)
			case 'community':
			case 'communityNotFound':
			case 'communityDetail':
			case 'brandGuide':
				throw new Error('Public pages require the Start document renderer')
			case 'adminLogin':
			case 'adminUsers':
			case 'adminUserDetail':
			case 'adminAudit':
			case 'adminConfig':
			case 'login':
			case 'setup':
			case 'signinLinkExpired':
			case 'signinLinkPassword':
			case 'oauthAuthorize':
			case 'oauthAuthorizeError':
			case 'connectOauth':
			case 'connectOauthDone':
			case 'connectOauthError':
			case 'connectSecretSet':
				throw new Error(
					'Auth, connect and console pages require the Start document renderer',
				)
			default: {
				const _exhaustive: never = data
				void _exhaustive
				return null
			}
		}
	}
}
