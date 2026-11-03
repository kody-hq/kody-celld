import type {} from '@tanstack/router-core'
import type { AppRootProps } from '#universal/app-root-props.ts'
import type { DocumentTimestampLocale } from './document-locale.ts'

export type StartDocumentData = AppRootProps & {
	title: string
	timestampLocale: DocumentTimestampLocale
}

export type CelldStartRequestContext = {
	nonce: string
	document: StartDocumentData
}

declare module '@tanstack/router-core' {
	interface Register {
		server: { requestContext: CelldStartRequestContext }
	}
}
