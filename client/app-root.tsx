import { type Handle, css } from 'remix/component'
import { SiteFooter } from '#client/site-footer.tsx'
import { SiteHeader } from '#client/site-header.tsx'
import { Toaster } from '#client/toaster.tsx'
import { RouteView } from '#client/routes/index.tsx'
import { type AppRootProps } from '#universal/app-root-props.ts'
import { isAuthShellPage } from '#universal/loader-data.ts'
import { routes } from '#universal/routes.ts'
import {
	getAlertCardCss,
	pageGutter,
	visuallyHiddenUntilFocusedCss,
} from '#universal/styles/style-primitives.ts'
import { spacing } from '#universal/styles/tokens.ts'
import { getPageContainerCss } from '#client/page-layout.ts'

/** Same breakpoint as `accountManagementNarrowMq` — rail collapses to a row. */
const accountRailNarrowMq = '@media (max-width: 860px)'

export type { AppRootProps }

/**
 * Document body for every server-rendered page: skip link, header, `<main>`,
 * footer, toaster. Mirrors `packages/worker/client/app.tsx` minus the client
 * router, session fetching and marketing overlays — kody-celld renders the
 * whole page on the server and navigates with full documents. Auth-style
 * pages (sign-in, consent, connect) drop the header the way kody's `/login`
 * does; `isAuthShellPage` decides from the route data.
 */
export function AppRoot(handle: Handle<AppRootProps>) {
	return () => {
		const { session, pathname, flash, data } = handle.props
		const loginHref = routes.login.href()
		const authShell = isAuthShellPage(data.page)
		// Account and console shells carry a 200px rail; offset the flash into
		// the content column so it does not paint above the rail.
		const accountChrome =
			!authShell &&
			(pathname === '/account' ||
				pathname.startsWith('/account/') ||
				pathname === '/console' ||
				pathname.startsWith('/console/'))
		return (
			<div mix={css(rootCss)}>
				<a href="#main" mix={css(visuallyHiddenUntilFocusedCss)}>
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
				<main id="main" mix={css(mainCss)}>
					{flash ? (
						<div
							data-page-flash
							mix={css(
								authShell
									? authFlashWrapCss
									: accountChrome
										? accountFlashWrapCss
										: flashWrapCss,
							)}
						>
							<p
								class={`flash ${flash.kind}`}
								role={flash.kind === 'error' ? 'alert' : 'status'}
								mix={css(
									getAlertCardCss(flash.kind === 'error' ? 'error' : 'info'),
								)}
							>
								{flash.text}
							</p>
						</div>
					) : null}
					<RouteView
						data={data}
						pathname={pathname}
						signedIn={session != null}
					/>
				</main>
				<SiteFooter
					loggedIn={session != null}
					loginHref={loginHref}
					version={handle.props.version}
				/>
				<Toaster />
			</div>
		)
	}
}

const rootCss = {
	display: 'flex',
	flexDirection: 'column' as const,
	minHeight: '100vh',
}

/** Every route renders one page box from `#client/page-layout.ts` in here. */
const mainCss = {
	flex: '1 1 auto',
	width: '100%',
	boxSizing: 'border-box' as const,
}

const flashWrapCss = {
	...getPageContainerCss('app'),
	paddingTop: spacing.lg,
}

/** Same left inset as `AccountManagementShell` when the rail is beside content. */
const accountFlashWrapCss = {
	...getPageContainerCss('app'),
	paddingTop: spacing.sm,
	paddingBottom: 0,
	paddingLeft: `calc(${pageGutter} + 200px + clamp(2rem, 5vw, 4.5rem))`,
	[accountRailNarrowMq]: {
		paddingLeft: pageGutter,
	},
}

const authFlashWrapCss = {
	...getPageContainerCss('auth'),
	paddingTop: spacing.xl,
}
