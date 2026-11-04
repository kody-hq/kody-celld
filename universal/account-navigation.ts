import { type IconName } from './icon-names.ts'
import { routes } from './routes.ts'

export const accountNavItems = [
	{ href: routes.account.href(), label: 'Overview', icon: 'home' },
	{ href: routes.accountPackages.href(), label: 'Packages', icon: 'box' },
	{
		href: routes.accountActivity.href(),
		label: 'Activity',
		icon: 'trending-up',
	},
	{ href: routes.accountJobs.href(), label: 'Jobs', icon: 'briefcase' },
	{ href: routes.accountWorkflows.href(), label: 'Workflows', icon: 'refresh' },
	{ href: routes.accountWebhooks.href(), label: 'Webhooks', icon: 'cloud' },
	{ href: routes.accountSecrets.href(), label: 'Secrets', icon: 'key' },
	{
		href: routes.accountIntegrations.href(),
		label: 'Integrations',
		icon: 'plug',
	},
	{
		href: routes.accountMcpServers.href(),
		label: 'MCP servers',
		icon: 'server',
	},
	{
		href: routes.accountMcpOauthClients.href(),
		label: 'MCP clients',
		icon: 'server',
	},
	{ href: routes.accountMemories.href(), label: 'Memories', icon: 'book' },
	{ href: routes.accountEmail.href(), label: 'Email', icon: 'mail' },
	{ href: routes.accountApiTokens.href(), label: 'API tokens', icon: 'link' },
	{ href: routes.accountSessions.href(), label: 'Sessions', icon: 'clock' },
] as const satisfies ReadonlyArray<{
	href: string
	label: string
	icon: IconName
}>

export function isAccountNavItemActive(itemHref: string, currentPath: string) {
	if (itemHref === routes.account.href()) return currentPath === itemHref
	return currentPath === itemHref || currentPath.startsWith(`${itemHref}/`)
}
