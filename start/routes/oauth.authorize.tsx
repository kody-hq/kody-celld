/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { OauthAuthorize, OauthAuthorizeError } from '../pages/oauth-authorize.tsx'
import { Route as Root } from './__root.tsx'

export const Route = createFileRoute('/oauth/authorize')({ component: OauthAuthorizeRoute })

function OauthAuthorizeRoute() {
	const { data } = Root.useLoaderData()
	if (data.page === 'oauthAuthorize') return <OauthAuthorize data={data} />
	if (data.page === 'oauthAuthorizeError') return <OauthAuthorizeError data={data} />
	throw new Error('OAuth authorization document data required')
}
