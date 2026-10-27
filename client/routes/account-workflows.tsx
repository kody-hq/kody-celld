import { css, type Handle } from 'remix/component'
import {
	type AppLoaderData,
	type WorkflowView,
} from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import { colors, typography } from '#universal/styles/tokens.ts'
import {
	AccountManagementPanel,
	AccountManagementShell,
	AccountPageHeader,
	TimestampValue,
} from './account-management-components.tsx'
import { Code, DangerForm, Muted } from './form-controls.tsx'
import { RecordTable } from './record-table.tsx'

type Data = Extract<AppLoaderData, { page: 'accountWorkflows' }>

const statusLabels: Record<WorkflowView['status'], string> = {
	queued: 'Queued',
	running: 'Running',
	complete: 'Complete',
	errored: 'Errored',
	cancelled: 'Cancelled',
}

function isActive(workflow: WorkflowView) {
	return workflow.status === 'queued' || workflow.status === 'running'
}

/** `/account/workflows`: durable workflow runs with cancel. */
export function AccountWorkflows(
	handle: Handle<{ data: Data; pathname: string }>,
) {
	return () => {
		const d = handle.props.data
		const action = routes.accountWorkflows.href()
		const active = d.workflows.filter(isActive).length
		return (
			<AccountManagementShell>
				<AccountPageHeader
					title="Workflows"
					description="Inspect deferred and long-running workflow runs (inline or package-backed), including status, schedule time, and errors. Cancel a run that has not finished yet."
					currentHref={handle.props.pathname}
				/>
				<AccountManagementPanel ariaLabel="Workflow runs">
					<RecordTable
						mode="none"
						ariaLabel="Workflow runs"
						emptyLabel="No workflows yet. Start one with workflows.create from kody:runtime."
						countLabel={`${d.workflows.length} total, ${active} active`}
						columns={[
							{ key: 'name', label: 'Workflow', primary: true },
							{ key: 'source', label: 'Source', drop: 2 },
							{ key: 'status', label: 'Status' },
							{ key: 'runAt', label: 'Run at', drop: 1 },
							{ key: 'updated', label: 'Updated', drop: 3 },
							{ key: 'actions', label: 'Actions' },
						]}
						rows={d.workflows.map((workflow) => ({
							id: workflow.id,
							cells: {
								name: (
									<>
										<strong>{workflow.workflowName}</strong>
										<br />
										<Muted small>
											{workflow.idempotencyKey ?? workflow.id}
										</Muted>
									</>
								),
								source:
									workflow.sourceType === 'package' ? (
										<Code>
											{workflow.packageId}
											{workflow.exportName ? ` ${workflow.exportName}` : ''}
										</Code>
									) : (
										<Muted>inline</Muted>
									),
								status: (
									<>
										{statusLabels[workflow.status]}
										{workflow.attempts > 1 ? (
											<Muted small> (attempt {workflow.attempts})</Muted>
										) : null}
										{workflow.lastError ? (
											<>
												<br />
												<span
													mix={css({
														color: colors.error,
														fontSize: typography.fontSize.sm,
													})}
												>
													{workflow.lastError}
												</span>
											</>
										) : null}
									</>
								),
								runAt: <TimestampValue value={workflow.runAt} />,
								updated: <TimestampValue value={workflow.updatedAt} />,
								actions: isActive(workflow) ? (
									<DangerForm
										action={action}
										csrf={d.csrf}
										fields={{ action: 'cancel', id: workflow.id }}
										label="Cancel"
										confirmLabel={
											workflow.status === 'running'
												? 'Confirm cancel (the running attempt finishes, its result and retries are discarded)'
												: 'Confirm cancel'
										}
									/>
								) : (
									<Muted>none</Muted>
								),
							},
						}))}
					/>
				</AccountManagementPanel>
			</AccountManagementShell>
		)
	}
}
