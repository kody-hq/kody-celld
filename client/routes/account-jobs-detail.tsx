import { css, type Handle } from 'remix/component'
import { type AppLoaderData } from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import { primaryLinkCss } from '#universal/styles/style-primitives.ts'
import {
	AccountManagementPanel,
	AccountManagementShell,
	AccountPageHeader,
	IdValue,
	MetadataGrid,
	TimestampValue,
} from './account-management-components.tsx'
import { ActionForm, Actions, Badge, Code, Muted } from './form-controls.tsx'
import { RecordTable } from './record-table.tsx'

type Data = Extract<AppLoaderData, { page: 'accountJobDetail' }>

function statusTone(status: string | null) {
	if (status === 'success') return 'ok'
	if (status === 'error') return 'danger'
	if (status === 'running') return 'warn'
	return 'neutral'
}

export function AccountJobDetail(
	handle: Handle<{ data: Data; pathname: string }>,
) {
	return () => {
		const { data, pathname } = handle.props
		const { job } = data
		const detailHref = routes.accountJobDetail.href({ jobId: job.id })

		return (
			<AccountManagementShell>
				<AccountPageHeader
					title={job.jobName}
					description={
						job.description ?? 'Scheduled work declared by a package.'
					}
					currentHref={pathname}
					belowDescription={
						<a href={routes.accountJobs.href()} mix={css(primaryLinkCss)}>
							Back to jobs
						</a>
					}
					actions={
						<Actions>
							<ActionForm
								action={detailHref}
								csrf={data.csrf}
								fields={{ action: 'run', id: job.id }}
								label="Run now"
								pendingLabel="Running…"
							/>
							<ActionForm
								action={detailHref}
								csrf={data.csrf}
								fields={{
									action: 'toggle',
									id: job.id,
									enabled: job.enabled ? 'false' : 'true',
								}}
								label={job.enabled ? 'Pause' : 'Resume'}
							/>
						</Actions>
					}
				/>
				<AccountManagementPanel ariaLabel="Job details">
					<MetadataGrid
						items={[
							{
								label: 'Job id',
								// Full row so scope/package#job stays on one line
								// at 1280 instead of a third-column stub.
								wide: true,
								value: <IdValue value={job.id} label="job id" copy="ghost" />,
							},
							{
								label: 'Package',
								value: data.packageExists ? (
									<a
										href={routes.accountPackageDetail.href({
											name: job.packageName,
										})}
										mix={css(primaryLinkCss)}
									>
										{job.packageName}
									</a>
								) : (
									<Muted>{job.packageName} (package unavailable)</Muted>
								),
							},
							{ label: 'Entry', value: <Code>{job.entry}</Code> },
							{ label: 'Schedule', value: job.schedule },
							{ label: 'Timezone', value: job.timezone ?? '—' },
							{
								label: 'Status',
								value: (
									<Badge tone={job.enabled ? 'ok' : 'neutral'}>
										{job.enabled ? 'Enabled' : 'Paused'}
									</Badge>
								),
							},
							{
								label: 'Next run',
								value: <TimestampValue value={job.nextRunAt} />,
							},
							{
								label: 'Last run',
								value: (
									<TimestampValue value={job.lastRunAt} fallback="never" />
								),
							},
							{
								label: 'Last status',
								value: job.lastStatus ? (
									<Badge tone={statusTone(job.lastStatus)}>
										{job.lastStatus}
									</Badge>
								) : (
									'—'
								),
							},
						]}
					/>
					{job.lastError ? (
						<p role="status">
							Last error: <span>{job.lastError}</span>
						</p>
					) : null}
				</AccountManagementPanel>
				<AccountManagementPanel title="Recent runs">
					<RecordTable
						mode="none"
						ariaLabel="Recent job runs"
						emptyLabel="No runs recorded yet."
						columns={[
							{
								key: 'trigger',
								label: 'Trigger',
								primary: true,
								width: '6rem',
							},
							// Full locale timestamp at 1280 and mid (~850).
							{ key: 'started', label: 'Started', width: '12.5rem' },
							{ key: 'duration', label: 'Duration', width: '6.5rem' },
							{
								key: 'status',
								label: 'Status',
								width: '7rem',
								// Badges must not ellipsize inside the cell.
								wrap: true,
							},
							{ key: 'error', label: 'Error', drop: 2 },
						]}
						rows={data.runs.map((run) => ({
							id: run.id,
							cells: {
								trigger: run.trigger,
								started: <TimestampValue value={run.startedAt} />,
								duration:
									run.durationMs === null
										? `${run.finishedAt ? '—' : 'Running'}`
										: `${run.durationMs} ms`,
								status: (
									<Badge tone={statusTone(run.status)}>{run.status}</Badge>
								),
								error: run.error ?? '—',
							},
						}))}
					/>
				</AccountManagementPanel>
			</AccountManagementShell>
		)
	}
}
