/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { ConnectOauth, ConnectOauthDone, ConnectOauthError } from '../pages/connect-oauth.tsx'
import { Route as Root } from './__root.tsx'

export const Route = createFileRoute('/connect/oauth/$')({ component: ConnectOauthRoute })

function ConnectOauthRoute() {
	const { data } = Root.useLoaderData()
	if (data.page === 'connectOauth') return <ConnectOauth data={data} />
	if (data.page === 'connectOauthDone') return <ConnectOauthDone data={data} />
	if (data.page === 'connectOauthError') return <ConnectOauthError data={data} />
	throw new Error('OAuth connect document data required')
}
