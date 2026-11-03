/** @jsxImportSource react */
import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { hydrateStart } from '@tanstack/react-start/client'
import { RouterProvider } from '@tanstack/react-router'

function reportError(error: unknown) {
	console.error('Document hydration error:', error)
}

hydrateStart()
	.then((router) => {
		startTransition(() => {
			hydrateRoot(
				document,
				<StrictMode>
					<RouterProvider router={router} />
				</StrictMode>,
				{
					onCaughtError: reportError,
					onUncaughtError: reportError,
					onRecoverableError: reportError,
				},
			)
		})
	})
	.catch(reportError)
