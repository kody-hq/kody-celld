/** @jsxImportSource @emotion/react */
import { type AppLoaderData } from '#universal/loader-data.ts'
import { colors, spacing } from '#universal/styles/tokens.ts'
import { AuthShell } from './auth-shell.tsx'
import { Code, CsrfInput, Field, Muted, SubmitButton } from './form-controls.tsx'
type ConnectSecretSetData = Extract<
	AppLoaderData,
	{
		page: 'connectSecretSet'
	}
>
export function ConnectSecretSet(props: { data: ConnectSecretSetData }) {
	const d = props.data
	return (
		<AuthShell
			title={d.saved ? 'Secret saved' : 'Set this secret'}
			description={
				d.saved
					? 'This secret is saved. Return to your agent and continue.'
					: 'Paste the secret value below. Agents cannot set this for you.'
			}
		>
			{d.error ? (
				<p role="alert" css={{ margin: 0, color: colors.error }}>
					{d.error}
				</p>
			) : null}
			{d.unsupportedNote ? (
				<p role="note" css={{ margin: 0, color: colors.warningText }}>
					{d.unsupportedNote}
				</p>
			) : null}
			<section css={{ display: 'grid', gap: spacing.sm }}>
				<p css={{ margin: 0, display: 'grid', gap: spacing.xs }}>
					<Muted small>Secret name</Muted>
					<Code>{d.name}</Code>
				</p>
				{d.description ? (
					<p css={{ margin: 0, display: 'grid', gap: spacing.xs }}>
						<Muted small>Description</Muted>
						<span>{d.description}</span>
					</p>
				) : null}
				{d.scope === 'package' && d.packageId ? (
					<p css={{ margin: 0, display: 'grid', gap: spacing.xs }}>
						<Muted small>Package</Muted>
						<Code>{d.packageId}</Code>
					</p>
				) : null}
				{d.hosts.length > 0 ? (
					<div css={{ display: 'grid', gap: spacing.xs }}>
						<Muted small>These hosts will be approved for your account:</Muted>
						<ul
							css={{
								margin: 0,
								paddingLeft: '1.2rem',
								display: 'grid',
								gap: spacing.xs,
							}}
						>
							{d.hosts.map((host) => (
								<li key={host}>
									<Code>{host}</Code>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</section>
			{d.saved ? (
				<p role="status" css={{ margin: 0 }}>
					Saved. You can tell your agent it is done.
				</p>
			) : d.canSubmit ? (
				<form method="post" css={{ display: 'grid', gap: spacing.md }}>
					<CsrfInput token={d.csrf} />
					<Field
						label="Secret value"
						name="value"
						id="connect-secret-set-value"
						type="password"
						autoComplete="new-password"
						placeholder="Paste the secret value"
						required
						autoFocus={Boolean(d.name)}
						size="auth"
					/>
					<SubmitButton size="md">Save secret</SubmitButton>
				</form>
			) : null}
		</AuthShell>
	)
}
