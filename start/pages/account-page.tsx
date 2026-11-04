import { Route as Root } from '../routes/__root.tsx'
import { Account } from './account.tsx'
import { AccountActivity } from './account-activity.tsx'
import { AccountApiTokens } from './account-api-tokens.tsx'
import { AccountMcpOauthClients } from './account-mcp-oauth-clients.tsx'
import { AccountMemories } from './account-memories.tsx'
import { AccountSecrets } from './account-secrets.tsx'
import { AccountSecretsApprove } from './account-secrets-approve.tsx'
import { AccountSessions } from './account-sessions.tsx'
import { AccountIntegrations } from './account-integrations.tsx'
import { AccountWebhooks } from './account-webhooks.tsx'
import { AccountMcpServers } from './account-mcp-servers.tsx'
import { AccountMcpServerAuthorize } from './account-mcp-server-authorize.tsx'
import { AccountEmail } from './account-email.tsx'
import { AccountJobs } from './account-jobs.tsx'
import { AccountJobDetail } from './account-jobs-detail.tsx'
import { AccountWorkflows } from './account-workflows.tsx'
import { AccountPackages } from './account-packages.tsx'
import { AccountPackageDetail } from './account-package-detail.tsx'
import { PackageFiles } from './package-files.tsx'
import { PackagePreviewFiles } from './package-preview-files.tsx'

export function AccountPage() {
	const { data, pathname } = Root.useLoaderData()
	switch (data.page) {
		case 'account':
			return <Account data={data} pathname={pathname} />
		case 'accountSessions':
			return <AccountSessions data={data} pathname={pathname} />
		case 'accountApiTokens':
			return <AccountApiTokens data={data} pathname={pathname} />
		case 'accountMcpOauthClients':
			return <AccountMcpOauthClients data={data} pathname={pathname} />
		case 'accountMemories':
			return <AccountMemories data={data} pathname={pathname} />
		case 'accountActivity':
			return <AccountActivity data={data} pathname={pathname} />
		case 'accountSecrets':
			return <AccountSecrets data={data} pathname={pathname} />
		case 'accountSecretApprove':
			return <AccountSecretsApprove data={data} pathname={pathname} />
		case 'accountIntegrations':
			return <AccountIntegrations data={data} pathname={pathname} />
		case 'accountWebhooks':
			return <AccountWebhooks data={data} pathname={pathname} />
		case 'accountMcpServers':
			return <AccountMcpServers data={data} pathname={pathname} />
		case 'accountMcpServerAuthorize':
			return <AccountMcpServerAuthorize data={data} pathname={pathname} />
		case 'accountEmail':
			return <AccountEmail data={data} pathname={pathname} />
		case 'accountJobs':
			return <AccountJobs data={data} pathname={pathname} />
		case 'accountJobDetail':
			return <AccountJobDetail data={data} pathname={pathname} />
		case 'accountWorkflows':
			return <AccountWorkflows data={data} pathname={pathname} />
		case 'accountPackages':
			return <AccountPackages data={data} pathname={pathname} />
		case 'accountPackageDetail':
			return <AccountPackageDetail data={data} pathname={pathname} />
		case 'accountPackageFiles':
			return <PackageFiles data={data} pathname={pathname} />
		case 'accountPackagePreviewFiles':
			return <PackagePreviewFiles data={data} pathname={pathname} />
		default:
			throw new Error('Account document data required')
	}
}
