/** @jsxImportSource @emotion/react */
import { type AppLoaderData, type PasswordFormView } from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import { mutedLinkCss } from '#universal/styles/style-primitives.ts'
import { colors } from '#universal/styles/tokens.ts'
import { AuthSection, AuthShell } from './auth-shell.tsx'
import { Code, CsrfInput, Field, Hidden, Muted, StackedForm, SubmitButton } from './form-controls.tsx'
type LoginData = Extract<
	AppLoaderData,
	{
		page: 'login'
	}
>
/**
 * `/signin`. Three plain POST forms — password, emailed link (only when an
 * outbound email adapter exists), API token — each tagged with a hidden
 * `method` the handler switches on. No JS required.
 */
export function Login(props: { data: LoginData }) {
	const { next, email, magicLinks } = props.data
	return (
		<AuthShell
			title="Sign in"
			description="Your self-hosted Kody. Sign in to manage packages, secrets, jobs and connected MCP clients."
		>
			<AuthSection title="Email and password" first>
				<StackedForm action={routes.login.href()}>
					<Hidden name="intent" value="password" />
					<Hidden name="next" value={next} />
					<Field label="Email" name="email" type="email" autoComplete="username" value={email} required />
					<Field label="Password" name="password" type="password" autoComplete="current-password" required />
					<div>
						<SubmitButton size="md">Sign in</SubmitButton>
					</div>
				</StackedForm>
			</AuthSection>
			{magicLinks ? (
				<AuthSection title="Email me a link">
					<StackedForm action={routes.login.href()}>
						<Hidden name="intent" value="magic" />
						<Hidden name="next" value={next} />
						<Field label="Email" name="email" id="field-magic-email" type="email" autoComplete="username" required />
						<div>
							<SubmitButton variant="secondary" size="md">
								Send sign-in link
							</SubmitButton>
						</div>
					</StackedForm>
				</AuthSection>
			) : null}
			<AuthSection title="API token">
				<Muted small>
					Have a <Code>kc_…</Code> token from the admin? Paste it to sign in and set a password.
				</Muted>
				<StackedForm action={routes.login.href()}>
					<Hidden name="intent" value="token" />
					<Hidden name="next" value={next} />
					<Field label="Token" name="token" type="password" autoComplete="off" required />
					<div>
						<SubmitButton variant="secondary" size="md">
							Sign in with token
						</SubmitButton>
					</div>
				</StackedForm>
			</AuthSection>
			<p css={{ margin: 0, color: colors.textMuted, fontSize: '0.92rem' }}>
				No account? Ask the operator for an invite link
				{magicLinks ? '' : ' or an API token'}. Operators use the{' '}
				<a href={routes.admin.href()} css={mutedLinkCss}>
					admin console
				</a>
				.
			</p>
		</AuthShell>
	)
}
type SetupData = Extract<
	AppLoaderData,
	{
		page: 'setup'
	}
>
/** `/setup`: the first account, gated on `KODY_ADMIN_TOKEN`. */
export function Setup(props: { data: SetupData }) {
	const { passwordMinLength } = props.data
	return (
		<AuthShell
			title="Set up Kody"
			description={
				<>
					No accounts exist yet. Create the first one with the admin token from your deployment's{' '}
					<Code>KODY_ADMIN_TOKEN</Code> (see <Code>.env</Code> or the Docker volume).
				</>
			}
		>
			<StackedForm action={routes.setup.href()}>
				<Field label="Admin token" name="adminToken" type="password" autoComplete="off" required />
				<Field label="Your email" name="email" type="email" autoComplete="email" required />
				<Field
					label={`Password (${passwordMinLength}+ characters)`}
					name="password"
					type="password"
					autoComplete="new-password"
					minLength={passwordMinLength}
					required
				/>
				<Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
				<div>
					<SubmitButton size="md">Create account</SubmitButton>
				</div>
			</StackedForm>
		</AuthShell>
	)
}
/** Shared by `/account` (change) and one-time links (set/reset). */
export function PasswordForm(props: {
	form: PasswordFormView
	csrf?: string
	username: string
	/** `md` on the auth card, `sm` (default) on the account page. */
	size?: 'sm' | 'md'
}) {
	const { form, csrf, username, size } = props
	return (
		<StackedForm action={form.action}>
			{csrf ? <CsrfInput token={csrf} /> : null}
			<input type="text" autoComplete="username" defaultValue={username} hidden readOnly />
			{form.requireCurrent ? (
				<Field label="Current password" name="current" type="password" autoComplete="current-password" required />
			) : null}
			<Field
				label={`New password (${form.minLength}+ characters)`}
				name="password"
				type="password"
				autoComplete="new-password"
				minLength={form.minLength}
				required
			/>
			<Field label="Confirm" name="confirm" type="password" autoComplete="new-password" required />
			<div>
				<SubmitButton size={size}>{form.submit}</SubmitButton>
			</div>
		</StackedForm>
	)
}
type LinkPasswordData = Extract<
	AppLoaderData,
	{
		page: 'signinLinkPassword'
	}
>
export function SigninLinkPassword(props: { data: LinkPasswordData }) {
	const { kind, email, passwordForm } = props.data
	return (
		<AuthShell
			title={kind === 'invite' ? 'Welcome to Kody' : 'Reset your password'}
			description={
				<>
					{kind === 'invite' ? 'Set a password for ' : 'Choose a new password for '}
					<strong>{email}</strong>.
				</>
			}
		>
			<PasswordForm form={passwordForm} size="md" username={email} />
		</AuthShell>
	)
}
export function SigninLinkExpired() {
	return (
		<AuthShell title="Link expired">
			<p css={{ margin: 0 }}>This sign-in link is invalid, expired, or was already used.</p>
			<p css={{ margin: 0 }}>
				<a href={routes.login.href()}>Back to sign in</a>
			</p>
		</AuthShell>
	)
}
