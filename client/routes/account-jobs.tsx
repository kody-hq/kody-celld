import { css, type Handle } from 'remix/component'
import { type AppLoaderData } from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import { primaryLinkCss } from '#universal/styles/style-primitives.ts'
import { colors, typography } from '#universal/styles/tokens.ts'
import {
	AccountManagementPanel,
	AccountManagementShell,
	AccountPageHeader,
	TimestampValue,
} from './account-management-components.tsx'
import { ActionForm, Actions, Code, Muted } from './form-controls.tsx'
import { RecordTable } from './record-table.tsx'

type Data = Extract<AppLoaderData, { page: 'accountJobs' }>

/** `/account/jobs`: package-owned schedules with run now and pause/resume. */
export function AccountJobs(handle: Handle<{ data: Data; pathname: string }>) {
	return () => {
		const d = handle.props.data
		const action = routes.accountJobs.href()
		return (
			<AccountManagementShell>
				<AccountPageHeader
					title="Jobs"
					description="Recurring work declared by your packages (kody.jobs in the manifest). Paused jobs keep their schedule but do not run."
					currentHref={handle.props.pathname}
				/>
				<AccountManagementPanel ariaLabel="Scheduled jobs">
					<RecordTable
						mode="none"
						ariaLabel="Jobs"
						emptyLabel="No jobs. Jobs come from package manifests."
						countLabel={`${d.jobs.length} total`}
						columns={[
							// Wrap so scope/package/job shows in full beside Actions.
							{ key: 'job', label: 'Job', primary: true, wrap: true },
							{ key: 'schedule', label: 'Schedule', drop: 3 },
							// Account shell content is ~50rem beside the rail.
							// Shed Last with Schedule at 900px so Next, Status,
							// and Actions keep their design-system widths.
							{ key: 'next', label: 'Next run', drop: 2, width: '11.75rem' },
							{ key: 'last', label: 'Last run', drop: 3, width: '11.75rem' },
							{ key: 'status', label: 'Status', drop: 1, width: '5.25rem' },
							// Two equal sm ghost buttons + 0.7rem gap + cell pad.
							{ key: 'actions', label: 'Actions', width: '16.25rem' },
						]}
						rows={d.jobs.map((job) => {
							const jobLabel = `${job.packageName}/${job.jobName}`
							return {
								id: job.id,
								cells: {
									job: (
										<>
											<a
												href={routes.accountJobDetail.href({ jobId: job.id })}
												title={jobLabel}
												mix={css(primaryLinkCss)}
											>
												<strong>{jobLabel}</strong>
											</a>
											{job.description ? (
												<>
													<br />
													<Muted small>{job.description}</Muted>
												</>
											) : null}
										</>
									),
									schedule: (
										<>
											<Code>{job.schedule}</Code>
											{job.timezone ? (
												<Muted small> {job.timezone}</Muted>
											) : null}
										</>
									),
									next: job.enabled ? (
										<TimestampValue value={job.nextRunAt} />
									) : (
										<Muted>paused</Muted>
									),
									last: (
										<TimestampValue value={job.lastRunAt} fallback="never" />
									),
									status: (
										<>
											{job.lastStatus ?? '—'}
											{job.lastError ? (
												<>
													<br />
													<span
														mix={css({
															color: colors.error,
															fontSize: typography.fontSize.sm,
														})}
													>
														{job.lastError}
													</span>
												</>
											) : null}
										</>
									),
									actions: (
										<Actions layout="inline">
											<ActionForm
												action={action}
												csrf={d.csrf}
												fields={{ action: 'run', id: job.id }}
												label="Run now"
												pendingLabel="Running…"
											/>
											<ActionForm
												action={action}
												csrf={d.csrf}
												fields={{
													action: 'toggle',
													id: job.id,
													enabled: job.enabled ? 'false' : 'true',
												}}
												label={job.enabled ? 'Pause' : 'Resume'}
											/>
										</Actions>
									),
								},
							}
						})}
					/>
				</AccountManagementPanel>
			</AccountManagementShell>
		)
	}
}
