import { type Handle } from 'remix/component'
import { type AppLoaderData } from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import {
	AccountManagementPanel,
	AccountManagementShell,
	AccountPageHeader,
} from './account-management-components.tsx'
import { ActionForm, Code, Muted } from './form-controls.tsx'

type Data = Extract<AppLoaderData, { page: 'accountSecretApprove' }>

export function AccountSecretsApprove(
	handle: Handle<{ data: Data; pathname: string }>,
) {
	return () => {
		const d = handle.props.data
		return (
			<AccountManagementShell>
				<AccountPageHeader
					title="Approve package access"
					description="Only the account owner can approve package access to a user secret."
					currentHref={routes.accountSecrets.href()}
				/>
				<AccountManagementPanel title="Review access request">
					<p>
						Allow <Code>{d.packageName}</Code> to use <Code>{d.name}</Code>?
					</p>
					{d.allowedPackages.length === 0 ? (
						<p>
							This secret currently allows any package. Approving this request
							will limit package use to the approved list.
						</p>
					) : (
						<p>
							Currently approved packages:{' '}
							{d.allowedPackages.map((packageName) => (
								<Code key={packageName}>{packageName}</Code>
							))}
						</p>
					)}
					{d.alreadyGranted ? (
						<Muted>This package is already approved.</Muted>
					) : (
						<ActionForm
							action={routes.accountSecretsApprove.href()}
							csrf={d.csrf}
							fields={{
								action: 'allow',
								name: d.name,
								packageName: d.packageName,
							}}
							label="Allow package"
						/>
					)}
				</AccountManagementPanel>
			</AccountManagementShell>
		)
	}
}
