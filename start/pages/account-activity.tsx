/** @jsxImportSource @emotion/react */
import { css, type CSSObject } from '@emotion/react'
import { CopyTextButton } from '../components/copy-text-button.tsx'
import { type AppLoaderData } from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import { activityErrorReviewPrompt } from '#universal/run-fix-prompt.ts'
import { colors, spacing, typography } from '#universal/styles/tokens.ts'
import {
	AccountManagementPanel,
	AccountManagementShell,
	AccountPageHeader,
	TimestampValue,
} from './account-management-components.tsx'
import { ActionForm, Actions, Badge, Lede, Muted } from './form-controls.tsx'
import { RecordTable } from './record-table.tsx'

type Data = Extract<AppLoaderData, { page: 'accountActivity' }>

function plural(n: number, one: string, many: string) {
	return `${n} ${n === 1 ? one : many}`
}

function statusTone(status: string) {
	return status === 'success' ? 'ok' : status === 'error' ? 'danger' : 'neutral'
}

export function AccountActivity(props: { data: Data; pathname: string }) {
	const d = props.data
	const base = routes.accountActivity.href()
	const runHref = (id: string) => `${base}/${encodeURIComponent(id)}?view=${d.view}`
	const triageForm = (runId: string, triage: 'ignored' | 'resolved' | 'open', label: string) => (
		<ActionForm
			action={base}
			csrf={d.csrf}
			fields={{
				action: 'triage',
				runId,
				triage,
				view: d.view,
			}}
			label={label}
			ariaLabel={`${label} run ${runId}`}
		/>
	)
	const triageActions = (run: { id: string; status: string; errorTriage: string | null }) =>
		run.status !== 'error' ? null : run.errorTriage ? (
			<Actions>
				<Badge tone="neutral">{run.errorTriage}</Badge>
				{triageForm(run.id, 'open', 'Reopen')}
			</Actions>
		) : (
			<Actions>
				{triageForm(run.id, 'ignored', 'Ignore')}
				{triageForm(run.id, 'resolved', 'Resolve')}
			</Actions>
		)

	return (
		<AccountManagementShell>
			<AccountPageHeader
				title="Activity"
				description="The most recent runs of ad hoc code, package exports and jobs."
				currentHref={props.pathname}
			/>
			{d.error ? (
				<p role="alert" aria-live="assertive" css={{ color: colors.error, margin: 0 }}>
					{d.error}
				</p>
			) : null}
			<Lede>
				{plural(d.summary.errors, 'open error', 'open errors')} · {d.summary.ignored} ignored · {d.summary.resolved}{' '}
				resolved · {d.summary.running} running
			</Lede>
			<nav aria-label="Activity view" css={css(toggleCss)}>
				{d.view === 'errors' ? (
					<span aria-current="page" css={css(toggleCurrentCss)}>
						Open errors
					</span>
				) : (
					<a href={`${base}?view=errors`} css={css(toggleLinkCss)}>
						Open errors
					</a>
				)}
				{d.view === 'recent' ? (
					<span aria-current="page" css={css(toggleCurrentCss)}>
						Recent runs
					</span>
				) : (
					<a href={`${base}?view=recent`} css={css(toggleLinkCss)}>
						Recent runs
					</a>
				)}
			</nav>
			{d.view === 'errors' && d.summary.errors > 0 ? (
				<figure css={css(promptFigureCss)}>
					<figcaption css={css(promptCaptionCss)}>Ask your agent</figcaption>
					<blockquote css={css(promptQuoteCss)}>{activityErrorReviewPrompt}</blockquote>
					<CopyTextButton value={activityErrorReviewPrompt} idleLabel="Copy prompt" variant="ghost" />
				</figure>
			) : null}
			<AccountManagementPanel ariaLabel={d.view === 'errors' ? 'Open errors' : 'Recent runs'}>
				<div css={css(wholeRowLinkCss)}>
					<RecordTable
						mode="expand"
						ariaLabel="Runs"
						emptyLabel={d.view === 'errors' ? 'No open errors.' : 'No runs yet.'}
						countLabel={
							d.view === 'errors' && d.summary.errors > d.runs.length
								? `${d.runs.length} of ${d.summary.errors}`
								: `${d.runs.length} shown`
						}
						columns={[
							{ key: 'when', label: 'When', primary: true },
							// No `drop` columns: the expanded run's row spans every column,
							// and dropped ones would still take width. Kind and duration
							// are in the expanded run.
							{ key: 'package', label: 'Package' },
							{ key: 'status', label: 'Status' },
							{ key: 'error', label: 'Error' },
							{ key: 'triage', label: 'Triage' },
						]}
						rows={d.runs.map((run) => ({
							id: run.id,
							href: runHref(run.id),
							cells: {
								when: <TimestampValue value={run.createdAt} />,
								package: run.packageName ?? <Muted>ad hoc {run.kind}</Muted>,
								status: <Badge tone={statusTone(run.status)}>{run.status}</Badge>,
								error: run.error ? (
									<span css={css(oneLineCss)} title={run.error}>
										<Muted small>{run.error}</Muted>
									</span>
								) : (
									''
								),
								triage: triageActions(run) ?? '',
							},
						}))}
					/>
				</div>
			</AccountManagementPanel>
		</AccountManagementShell>
	)
}

const toggleCss: CSSObject = {
	display: 'flex',
	gap: spacing.md,
	fontSize: typography.fontSize.sm,
}

const toggleCurrentCss: CSSObject = {
	fontWeight: typography.fontWeight.semibold,
	color: colors.text,
}

const toggleLinkCss: CSSObject = {
	color: colors.primaryText,
	textDecoration: 'none',
	'&:hover': { textDecoration: 'underline' },
}

const promptFigureCss: CSSObject = {
	margin: 0,
	display: 'grid',
	gap: spacing.sm,
	justifyItems: 'start',
}

const promptCaptionCss: CSSObject = {
	fontSize: typography.fontSize.sm,
	fontWeight: typography.fontWeight.semibold,
	color: colors.text,
}

const promptQuoteCss: CSSObject = {
	margin: 0,
	paddingLeft: spacing.md,
	borderLeft: `3px solid ${colors.border}`,
	color: colors.textMuted,
	lineHeight: 1.5,
	overflowWrap: 'anywhere' as const,
}

const oneLineCss: CSSObject = {
	display: 'block',
	whiteSpace: 'nowrap' as const,
	overflow: 'hidden',
	textOverflow: 'ellipsis',
}

// The whole row opens the run: the row's own link (the When cell) is
// stretched over the row, and the triage forms sit above it so their buttons
// still submit. CSS only, so it works with JavaScript off.
const wholeRowLinkCss: CSSObject = {
	'& tbody tr:has(a[aria-expanded])': {
		position: 'relative',
		cursor: 'pointer',
	},
	'& tbody tr a[aria-expanded]::after': {
		content: "''",
		position: 'absolute',
		inset: 0,
	},
	'& tbody tr form': { position: 'relative', zIndex: 1 },
}
