import { Route as Root } from '../routes/__root.tsx'
import { Account } from './account.tsx'
import { AccountActivity } from './account-activity.tsx'
import { AccountApiTokens } from './account-api-tokens.tsx'
import { AccountMcpOauthClients } from './account-mcp-oauth-clients.tsx'
import { AccountMemories } from './account-memories.tsx'
import { AccountSecrets } from './account-secrets.tsx'
import { AccountSecretsApprove } from './account-secrets-approve.tsx'
import { AccountSessions } from './account-sessions.tsx'

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
		default:
			throw new Error('Account document data required')
	}
}
