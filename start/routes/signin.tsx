/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { Login } from '../pages/login.tsx'
import { Route as Root } from './__root.tsx'

export const Route = createFileRoute('/signin')({ component: SigninRoute })

function SigninRoute() {
	const { data } = Root.useLoaderData()
	if (data.page !== 'login') throw new Error('Sign-in document data required')
	return <Login data={data} />
}
