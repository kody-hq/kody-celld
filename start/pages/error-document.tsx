/** @jsxImportSource @emotion/react */
import { Route as Root } from '../routes/__root.tsx'
import { ErrorPage } from './error-page.tsx'

export function ErrorDocument() {
	const { data, session } = Root.useLoaderData()
	if (data.page !== 'error') throw new Error('Error document data required')
	return <ErrorPage data={data} signedIn={session != null} />
}
