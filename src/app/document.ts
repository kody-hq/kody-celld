import type { AppSession } from '#universal/app-session.ts'
import type { AppLoaderData, PageFlash } from '#universal/loader-data.ts'

export type RenderPageOptions = {
	title: string
	pathname: string
	data: AppLoaderData
	session?: AppSession | null
	flash?: PageFlash | null
	status?: number
	headers?: HeadersInit
}
