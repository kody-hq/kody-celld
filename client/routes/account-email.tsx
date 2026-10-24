import { css, type Handle, unsafeHTML } from 'remix/component'
import {
	buildAdminEmailHtmlPreviewDocument,
	emailHtmlPreviewSandbox,
} from '#client/email-html-preview.ts'
import {
	type AppLoaderData,
	type EmailBodyView,
	type EmailMessageDetailView,
} from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import { cardTitleCss } from '#universal/styles/style-primitives.ts'
import {
	colors,
	radius,
	spacing,
	typography,
} from '#universal/styles/tokens.ts'
import {
	AccountManagementPanel,
	AccountManagementShell,
	AccountPageHeader,
	MetadataGrid,
	TimestampValue,
} from './account-management-components.tsx'
import { Badge, Code, Lede, Muted, PreBlock } from './form-controls.tsx'
import { RecordTable, recordBodyCss } from './record-table.tsx'

type Data = Extract<AppLoaderData, { page: 'accountEmail' }>

const bodyTabs: Array<{ view: EmailBodyView; label: string }> = [
	{ view: 'html', label: 'HTML' },
	{ view: 'text', label: 'Text' },
	{ view: 'source', label: 'HTML Source' },
]

function messageHref(id: string, view?: EmailBodyView) {
	const href = routes.accountEmailMessage.href({ messageId: id })
	return view ? `${href}?body=${view}` : href
}

function directionLabel(direction: EmailMessageDetailView['direction']) {
	return direction === 'outbound' ? 'Outbound' : 'Inbound'
}

function listOrNone(values: Array<string>) {
	return values.length > 0 ? values.join(', ') : 'None'
}

function EmailBody(
	handle: Handle<{ message: EmailMessageDetailView; view: EmailBodyView }>,
) {
	return () => {
		const { message, view } = handle.props
		if (view === 'html') {
			return message.html ? (
				// Same rendering as hosted Kody (account-email-detail.tsx): scripts
				// stripped, then a `sandbox` that only allows popups (no scripts,
				// forms or same-origin access) and no referrer. Links open in a
				// normal new tab.
				<iframe
					title="Email HTML preview"
					sandbox={emailHtmlPreviewSandbox}
					referrerpolicy="no-referrer"
					srcDoc={unsafeHTML(buildAdminEmailHtmlPreviewDocument(message.html))}
					mix={css(htmlPreviewCss)}
				/>
			) : (
				<p mix={css(emptyBodyCss)}>No HTML body exists for this message.</p>
			)
		}
		const body = view === 'text' ? message.text : message.html
		return body ? (
			<PreBlock>{body}</PreBlock>
		) : (
			<p mix={css(emptyBodyCss)}>
				No {view === 'text' ? 'text' : 'HTML'} body exists for this message.
			</p>
		)
	}
}

function EmailMessageRecord(
	handle: Handle<{ message: EmailMessageDetailView; view: EmailBodyView }>,
) {
	return () => {
		const { message, view } = handle.props
		const quarantined = message.classification === 'quarantine'
		return (
			<section mix={css(recordBodyCss)} aria-label="Message">
				<div mix={css({ display: 'grid', gap: spacing.xs })}>
					<div
						mix={css({
							display: 'flex',
							flexWrap: 'wrap',
							gap: spacing.sm,
							alignItems: 'center',
						})}
					>
						<h2 mix={css({ ...cardTitleCss, overflowWrap: 'anywhere' })}>
							{message.subject || '(no subject)'}
						</h2>
						{quarantined ? <Badge tone="warn">Quarantined</Badge> : null}
					</div>
					<p mix={css({ margin: 0, color: colors.textMuted })}>
						{directionLabel(message.direction)} message
						{quarantined && message.classificationReason
							? ` · ${message.classificationReason}`
							: ''}
					</p>
				</div>
				<MetadataGrid
					items={[
						{ label: 'From', value: message.from || 'Unknown' },
						{ label: 'To', value: listOrNone(message.to) },
						{
							label: 'Date',
							value: (
								<TimestampValue value={message.receivedAt} fallback="Unknown" />
							),
						},
						{ label: 'Subject', value: message.subject || '(no subject)' },
						{ label: 'CC', value: listOrNone(message.cc) },
						{ label: 'Reply-To', value: listOrNone(message.replyTo) },
						...(message.inboxAddress
							? [{ label: 'Inbox', value: message.inboxAddress }]
							: []),
						...(message.direction === 'outbound'
							? [{ label: 'Delivery', value: message.deliveryStatus ?? 'None' }]
							: [
									{
										label: 'Classification',
										value: message.classification ?? 'None',
									},
								]),
						{
							label: 'Size',
							value: `${Math.round(message.sizeBytes / 1024)} KiB`,
						},
					]}
				/>
				{message.attachments.length > 0 ? (
					<section mix={css({ display: 'grid', gap: spacing.sm })}>
						<h3 mix={css(sectionHeadingCss)}>Attachments</h3>
						<ul
							mix={css({
								margin: 0,
								paddingLeft: spacing.lg,
								display: 'grid',
								gap: spacing.xs,
							})}
						>
							{message.attachments.map((attachment) => (
								<li key={attachment.id}>
									{attachment.filename || '(unnamed)'}
									<Muted small>
										{` · ${attachment.contentType} · ${attachment.size} bytes`}
									</Muted>
								</li>
							))}
						</ul>
						<Muted small>
							Agents read attachment content with{' '}
							<Code>emailAttachmentGet</Code>.
						</Muted>
					</section>
				) : null}
				<section mix={css({ display: 'grid', gap: spacing.sm })}>
					<h3 mix={css(sectionHeadingCss)}>Message body</h3>
					<nav aria-label="Email body" mix={css(tabsCss)}>
						{bodyTabs.map((tab) =>
							tab.view === view ? (
								<span
									key={tab.view}
									aria-current="page"
									mix={css(tabCurrentCss)}
								>
									{tab.label}
								</span>
							) : (
								<a
									key={tab.view}
									href={messageHref(message.id, tab.view)}
									mix={css(tabLinkCss)}
								>
									{tab.label}
								</a>
							),
						)}
					</nav>
					<EmailBody message={message} view={view} />
				</section>
			</section>
		)
	}
}

/**
 * `/account/inbox(/:messageId)`: claimed addresses and recent messages. A
 * row opens the message under itself with its headers and full body, like
 * hosted Kody's `/account/email/:messageId`.
 */
export function AccountEmail(handle: Handle<{ data: Data; pathname: string }>) {
	return () => {
		const d = handle.props.data
		const record = d.selected ? (
			<EmailMessageRecord message={d.selected} view={d.bodyView} />
		) : d.selectedId ? (
			<div mix={css({ ...recordBodyCss, gap: spacing.sm })}>
				<h2 mix={css(cardTitleCss)}>Message not found</h2>
				<p mix={css({ margin: 0, color: colors.textMuted })}>
					This message does not exist for this account, or it was deleted.
				</p>
			</div>
		) : null
		return (
			<AccountManagementShell>
				<AccountPageHeader
					title="Email"
					description="Inboxes your packages can receive on and messages they have sent."
					currentHref={handle.props.pathname}
				/>
				{d.domain === null ? (
					<AccountManagementPanel ariaLabel="Email status">
						<Lede>
							Email is not configured on this server (
							<Code>KODY_EMAIL_DOMAIN</Code>).
						</Lede>
					</AccountManagementPanel>
				) : (
					<>
						<AccountManagementPanel title="Addresses">
							{d.addresses.length === 0 ? (
								<Lede>
									None claimed yet — use <Code>emailInboxClaim</Code> from an
									MCP client.
								</Lede>
							) : (
								<p>
									{d.addresses.map((address) => (
										<>
											<Code key={address}>{address}</Code>{' '}
										</>
									))}
								</p>
							)}
						</AccountManagementPanel>
						<AccountManagementPanel ariaLabel="Messages">
							<RecordTable
								mode="expand"
								ariaLabel="Messages"
								emptyLabel="No messages."
								countLabel={`${d.messages.length} shown`}
								selectedId={d.selectedId}
								columns={[
									{ key: 'subject', label: 'Subject', primary: true },
									{ key: 'received', label: 'Received', drop: 2 },
									{ key: 'from', label: 'From / to', drop: 1 },
									{ key: 'class', label: 'Class', drop: 3 },
									{ key: 'size', label: 'Size', align: 'end', drop: 3 },
								]}
								rows={d.messages.map((message) => ({
									id: message.id,
									href: messageHref(message.id),
									cells: {
										subject: (
											<>
												{message.subject || <Muted>(no subject)</Muted>}
												<br />
												<Muted small>{message.snippet}</Muted>
											</>
										),
										received: <TimestampValue value={message.receivedAt} />,
										from: (
											<>
												{message.direction === 'outbound' ? (
													<Muted>→ </Muted>
												) : null}
												{message.counterpart}
											</>
										),
										class: message.classification ?? message.direction,
										size: `${Math.round(message.sizeBytes / 1024)} KiB`,
									},
								}))}
								record={record}
							/>
						</AccountManagementPanel>
					</>
				)}
			</AccountManagementShell>
		)
	}
}

const sectionHeadingCss = {
	margin: 0,
	fontSize: typography.fontSize.base,
	fontWeight: typography.fontWeight.semibold,
	color: colors.text,
}

const tabsCss = {
	display: 'flex',
	gap: spacing.md,
	fontSize: typography.fontSize.sm,
}

const tabCurrentCss = {
	fontWeight: typography.fontWeight.semibold,
	color: colors.text,
}

const tabLinkCss = {
	color: colors.primaryText,
	textDecoration: 'none',
	'&:hover': { textDecoration: 'underline' },
}

const emptyBodyCss = {
	margin: 0,
	color: colors.textMuted,
}

const htmlPreviewCss = {
	display: 'block',
	width: '100%',
	minHeight: '24rem',
	height: '32rem',
	resize: 'vertical' as const,
	border: `1px solid ${colors.border}`,
	borderRadius: radius.md,
	background: colors.surface,
}
