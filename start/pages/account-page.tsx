import { Route as Root } from '../routes/__root.tsx'
import { Account } from './account.tsx'
import { AccountSessions } from './account-sessions.tsx'

export function AccountPage() {
	const { data, pathname } = Root.useLoaderData()
	switch (data.page) {
		case 'account':
			return <Account data={data} pathname={pathname} />
		case 'accountSessions':
			return <AccountSessions data={data} pathname={pathname} />
		default:
			throw new Error('Account document data required')
	}
}
