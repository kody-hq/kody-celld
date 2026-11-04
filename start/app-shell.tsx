/** @jsxImportSource @emotion/react */
import type { ReactNode } from 'react'
import type { StartDocumentData } from './request-context.ts'
import { SiteHeader } from './components/site-header.tsx'
import { SiteFooter } from './components/site-footer.tsx'
import { Toaster } from './components/toaster.tsx'
import { routes } from '#universal/routes.ts'
import { isAuthShellPage } from '#universal/loader-data.ts'
import { getAlertCardCss, visuallyHiddenUntilFocusedCss } from '#universal/styles/style-primitives.ts'
import { getPageContainerCss } from '#client/page-layout.ts'
import { spacing } from '#universal/styles/tokens.ts'

export function AppShell({
	document: { session, pathname, data, flash, version },
	children,
}: {
	document: StartDocumentData
	children: ReactNode
}) {
	const loginHref = routes.login.href()
	const authShell = isAuthShellPage(data.page)
	return (
		<div css={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
			<a href="#main" css={visuallyHiddenUntilFocusedCss}>
				Skip to content
			</a>
			{authShell ? null : (
				<SiteHeader
					loggedIn={session != null}
					displayName={session?.displayName ?? ''}
					avatarUrl={session?.avatarUrl ?? null}
					showAdminLink={session?.isAdmin ?? false}
					loginHref={loginHref}
					currentPathname={pathname}
				/>
			)}
			{/* Clip decorative bleed (the brand guide hero glow, #156) so it never
			    widens the mobile layout viewport. clip, unlike hidden, makes no
			    scroll container, so sticky children keep working. */}
			<main id="main" css={{ flex: '1 1 auto', width: '100%', boxSizing: 'border-box', overflowX: 'clip' }}>
				{flash ? (
					<div
						data-page-flash
						css={{
							...getPageContainerCss(authShell ? 'auth' : 'app'),
							paddingTop: authShell ? spacing.xl : spacing.lg,
						}}
					>
						<p
							className={`flash ${flash.kind}`}
							role={flash.kind === 'error' ? 'alert' : 'status'}
							css={getAlertCardCss(flash.kind === 'error' ? 'error' : 'info')}
						>
							{flash.text}
						</p>
					</div>
				) : null}
				{children}
			</main>
			<SiteFooter loggedIn={session != null} loginHref={loginHref} version={version} />
			<Toaster />
		</div>
	)
}
