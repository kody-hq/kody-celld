/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { SigninLinkExpired, SigninLinkPassword } from '../pages/login.tsx'
import { Route as Root } from './__root.tsx'

export const Route = createFileRoute('/signin_/link/$token')({ component: SigninLinkRoute })

function SigninLinkRoute() {
	const { data } = Root.useLoaderData()
	if (data.page === 'signinLinkExpired') return <SigninLinkExpired />
	if (data.page === 'signinLinkPassword') return <SigninLinkPassword data={data} />
	throw new Error('Sign-in link document data required')
}
