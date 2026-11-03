import type {} from '@tanstack/router-core'
import type { AppRootProps } from '#universal/app-root-props.ts'

export type StartDocumentData = AppRootProps & { title: string }

export type CelldStartRequestContext = {
	nonce: string
	document: StartDocumentData
}

declare module '@tanstack/router-core' {
	interface Register {
		server: { requestContext: CelldStartRequestContext }
	}
}
