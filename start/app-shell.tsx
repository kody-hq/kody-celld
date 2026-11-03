/** @jsxImportSource @emotion/react */
import type { ReactNode } from 'react'
import type { StartDocumentData } from './request-context.ts'
import { SiteHeader } from './components/site-header.tsx'
import { SiteFooter } from './components/site-footer.tsx'
import { Toaster } from './components/toaster.tsx'
import { routes } from '#universal/routes.ts'
import { getAlertCardCss, visuallyHiddenUntilFocusedCss } from '#universal/styles/style-primitives.ts'
import { getPageContainerCss } from '#client/page-layout.ts'
import { spacing } from '#universal/styles/tokens.ts'

export function AppShell({
	document: { session, pathname, flash, version },
	children,
}: {
	document: StartDocumentData
	children: ReactNode
}) {
	const loginHref = routes.login.href()
	return (
		<div css={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
			<a href="#main" css={visuallyHiddenUntilFocusedCss}>
				Skip to content
			</a>
			<SiteHeader
				loggedIn={session != null}
				displayName={session?.displayName ?? ''}
				avatarUrl={session?.avatarUrl ?? null}
				showAdminLink={session?.isAdmin ?? false}
				loginHref={loginHref}
				currentPathname={pathname}
			/>
			<main id="main" css={{ flex: '1 1 auto', width: '100%', boxSizing: 'border-box' }}>
				{flash ? (
					<div data-page-flash css={{ ...getPageContainerCss('app'), paddingTop: spacing.lg }}>
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
