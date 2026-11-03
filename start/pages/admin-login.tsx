/** @jsxImportSource @emotion/react */
import { routes } from '#universal/routes.ts'
import { mutedLinkCss } from '#universal/styles/style-primitives.ts'
import { AuthShell } from './auth-shell.tsx'
import { Code, Field, StackedForm, SubmitButton } from './form-controls.tsx'
export function AdminLogin() {
	return (
		<AuthShell
			title="Admin console"
			description={
				<>
					Sign in with the deployment's <Code>KODY_ADMIN_TOKEN</Code>. Looking for your own account?{' '}
					<a href={routes.login.href()} css={mutedLinkCss}>
						User sign-in
					</a>
					.
				</>
			}
		>
			<StackedForm action={routes.adminLogin.href()}>
				<Field label="Admin token" name="token" type="password" autoComplete="off" required />
				<div>
					<SubmitButton size="md">Sign in</SubmitButton>
				</div>
			</StackedForm>
		</AuthShell>
	)
}
