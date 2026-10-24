import { type Handle } from 'remix/component'
import { type AppLoaderData } from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import {
	AccountManagementPanel,
	AccountManagementShell,
	AccountPageHeader,
	TimestampValue,
} from './account-management-components.tsx'
import {
	Actions,
	Code,
	CsrfInput,
	DangerForm,
	Field,
	Hidden,
	Muted,
	StackedForm,
	SubmitButton,
} from './form-controls.tsx'
import { RecordTable } from './record-table.tsx'

type Data = Extract<AppLoaderData, { page: 'accountSecrets' }>

/**
 * `/account/secrets`. Lists names and metadata only. Values are encrypted
 * in the user cell and never rendered. Host approval is deliberately absent
 * here: it lives in the operator console.
 */
export function AccountSecrets(
	handle: Handle<{ data: Data; pathname: string }>,
) {
	return () => {
		const d = handle.props.data
		const action = routes.accountSecrets.href()
		return (
			<AccountManagementShell>
				<AccountPageHeader
					title="Secrets"
					description="Values are encrypted at rest and only injected into outbound requests to approved hosts by the fetch gateway. User secrets can be restricted to approved packages here. Reference them in code as {{secret:NAME}}."
					currentHref={handle.props.pathname}
				/>
				<AccountManagementPanel ariaLabel="Saved secrets">
					<RecordTable
						mode="none"
						ariaLabel="Secrets"
						emptyLabel="No secrets yet."
						countLabel={`${d.secrets.length} total`}
						columns={[
							{ key: 'name', label: 'Name', primary: true },
							{ key: 'scope', label: 'Scope', drop: 3 },
							{ key: 'description', label: 'Description', drop: 2 },
							{ key: 'packages', label: 'Allowed packages' },
							{ key: 'updated', label: 'Updated', drop: 1 },
							{ key: 'actions', label: 'Actions' },
						]}
						rows={d.secrets.map((secret) => ({
							id: `${secret.scope}:${secret.packageName ?? ''}:${secret.name}`,
							cells: {
								name: <Code>{secret.name}</Code>,
								scope: (
									<>
										{secret.scope}
										{secret.packageName ? (
											<Muted small> ({secret.packageName})</Muted>
										) : null}
									</>
								),
								description: secret.description ?? <Muted>-</Muted>,
								packages:
									secret.scope !== 'user' ? (
										<Muted small>Only {secret.packageName}</Muted>
									) : secret.allowedPackages.length === 0 ? (
										<Muted small>Any package</Muted>
									) : (
										<Actions>
											{secret.allowedPackages.map((packageName) => (
												<div key={packageName}>
													<Code>{packageName}</Code>
													<DangerForm
														action={action}
														csrf={d.csrf}
														fields={{
															action: 'remove_grant',
															name: secret.name,
															packageName,
														}}
														label="Remove grant"
														confirmLabel={
															secret.allowedPackages.length === 1
																? 'Confirm unlock'
																: 'Confirm removal'
														}
													/>
												</div>
											))}
										</Actions>
									),
								updated: <TimestampValue value={secret.updatedAt} />,
								actions: (
									<DangerForm
										action={action}
										csrf={d.csrf}
										fields={{
											action: 'delete',
											name: secret.name,
											packageName: secret.packageName ?? '',
										}}
										label="Delete"
									/>
								),
							},
						}))}
					/>
				</AccountManagementPanel>
				<AccountManagementPanel title="Add or replace a secret">
					<StackedForm action={action} autocomplete="off">
						<CsrfInput token={d.csrf} />
						<Hidden name="action" value="save" />
						<Field
							label="Name"
							name="name"
							pattern="[a-zA-Z0-9._\-]+"
							placeholder="GITHUB_TOKEN"
							required
						/>
						<Field label="Value" name="value" multiline required />
						<Field
							label="Description"
							name="description"
							placeholder="what it is for"
						/>
						<div>
							<SubmitButton>Save secret</SubmitButton>
						</div>
					</StackedForm>
				</AccountManagementPanel>
				<AccountManagementPanel
					title="Approved hosts"
					description="Secrets are only injected into requests to these hosts. Approvals are made by the operator (admin console), so ask them to approve a new host."
				>
					<RecordTable
						mode="none"
						ariaLabel="Approved hosts"
						emptyLabel="No approved hosts."
						columns={[
							{ key: 'host', label: 'Host', primary: true },
							{ key: 'approved', label: 'Approved', drop: 2 },
							{ key: 'by', label: 'By', drop: 3 },
						]}
						rows={d.hosts.map((host) => ({
							id: host.host,
							cells: {
								host: <Code>{host.host}</Code>,
								approved: <TimestampValue value={host.approvedAt} />,
								by: host.approvedBy,
							},
						}))}
					/>
				</AccountManagementPanel>
			</AccountManagementShell>
		)
	}
}
