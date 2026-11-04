/** @jsxImportSource @emotion/react */
import { css, type CSSObject } from '@emotion/react'
import { CopyTextButton } from '../components/copy-text-button.tsx'
import { type AppLoaderData } from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import { activityErrorReviewPrompt, buildRunFixPrompt } from '#universal/run-fix-prompt.ts'
import { cardTitleCss } from '#universal/styles/style-primitives.ts'
import { colors, spacing, typography } from '#universal/styles/tokens.ts'
import {
	AccountManagementPanel,
	AccountManagementShell,
	AccountPageHeader,
	MetadataGrid,
	TimestampValue,
} from './account-management-components.tsx'
import { ActionForm, Actions, Badge, Code, Lede, Muted, PreBlock } from './form-controls.tsx'
import { RecordTable, recordBodyCss } from './record-table.tsx'

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
	const triageForm = (runId: string, triage: 'ignored' | 'resolved' | 'open', label: string, open?: boolean) => (
		<ActionForm
			action={base}
			csrf={d.csrf}
			fields={{
				action: 'triage',
				runId,
				triage,
				view: d.view,
				...(open ? { open: runId } : {}),
			}}
			label={label}
			ariaLabel={`${label} run ${runId}`}
		/>
	)
	const triageActions = (run: { id: string; status: string; errorTriage: string | null }, open?: boolean) =>
		run.status !== 'error' ? null : run.errorTriage ? (
			<Actions>
				<Badge tone="neutral">{run.errorTriage}</Badge>
				{triageForm(run.id, 'open', 'Reopen', open)}
			</Actions>
		) : (
			<Actions>
				{triageForm(run.id, 'ignored', 'Ignore', open)}
				{triageForm(run.id, 'resolved', 'Resolve', open)}
			</Actions>
		)

	const selected = d.selected
	const fixPrompt =
		selected?.status === 'error'
			? buildRunFixPrompt({
					id: selected.id,
					kind: selected.kind,
					packageName: selected.packageName,
					jobId: selected.jobId,
					error: selected.error,
				})
			: null
	const runRecord = selected ? (
		<section data-testid="run-detail" css={css({ ...recordBodyCss, gap: spacing.md })}>
			<h2 css={css(cardTitleCss)}>
				{selected.packageName ?? 'Ad hoc'} · {selected.kind}
			</h2>
			<MetadataGrid
				items={[
					{
						label: 'Status',
						value: <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>,
					},
					{
						label: 'Triage',
						value: selected.errorTriage ?? (selected.status === 'error' ? 'open' : '—'),
					},
					...(selected.triageNote ? [{ label: 'Triage note', value: selected.triageNote }] : []),
					...(selected.triagedAt
						? [
								{
									label: 'Triaged',
									value: (
										<>
											<TimestampValue value={selected.triagedAt} />
											{selected.triagedBy ? ` by ${selected.triagedBy}` : ''}
										</>
									),
								},
							]
						: []),
					{ label: 'Started', value: <TimestampValue value={selected.createdAt} /> },
					{
						label: 'Duration',
						value: selected.durationMs === null ? '—' : `${selected.durationMs} ms`,
					},
					{
						label: 'Package',
						value: selected.packageName ? (
							<a
								href={routes.accountPackageDetail.href({
									name: selected.packageName,
								})}
							>
								{selected.packageName}
							</a>
						) : (
							'ad hoc'
						),
					},
					...(selected.jobId
						? [
								{
									label: 'Job',
									value: <a href={routes.accountJobDetail.href({ jobId: selected.jobId })}>{selected.jobId}</a>,
								},
							]
						: []),
					{ label: 'Run id', value: <Code>{selected.id}</Code> },
				]}
			/>
			{selected.error ? detailBlock('Error', selected.error) : null}
			{detailBlock(
				`Logs (${selected.logs.length})`,
				selected.logs.length > 0 ? selected.logs.join('\n') : 'No log lines.',
			)}
			{selected.result !== null ? detailBlock('Result', selected.result) : null}
			{selected.warnings.length > 0 ? detailBlock('Warnings', selected.warnings.join('\n')) : null}
			{selected.gateway.length > 0
				? detailBlock(
						'Gateway',
						selected.gateway
							.map(
								(g) =>
									`${g.outcome} ${g.method} ${g.host}${g.status === null ? '' : ` → ${g.status}`}${g.reason ? ` (${g.reason})` : ''}`,
							)
							.join('\n'),
					)
				: null}
			{fixPrompt ? (
				<figure css={css(promptFigureCss)}>
					<figcaption css={css(promptCaptionCss)}>Fix with AI</figcaption>
					<blockquote css={css(promptQuoteCss)}>{fixPrompt}</blockquote>
					<CopyTextButton value={fixPrompt} idleLabel="Copy fix prompt" variant="ghost" />
				</figure>
			) : null}
			{triageActions(selected, true)}
		</section>
	) : d.selectedId ? (
		<div css={css({ ...recordBodyCss, gap: spacing.sm })}>
			<h2 css={css(cardTitleCss)}>Run not found</h2>
			<p css={css({ margin: 0, color: colors.textMuted })}>
				This run does not exist for this account, or it was pruned from the run history.
			</p>
		</div>
	) : null

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
						selectedId={d.selectedId}
						record={runRecord}
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
							href: run.id === d.selectedId ? `${base}?view=${d.view}` : runHref(run.id),
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

function detailBlock(label: string, text: string) {
	return (
		<div css={css({ display: 'grid', gap: spacing.xs, minWidth: 0 })}>
			<span css={css(promptCaptionCss)}>{label}</span>
			<div css={css({ maxHeight: '24rem', overflow: 'auto' })}>
				<PreBlock>{text}</PreBlock>
			</div>
		</div>
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
