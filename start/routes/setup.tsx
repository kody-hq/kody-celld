/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { Setup } from '../pages/login.tsx'
import { Route as Root } from './__root.tsx'

export const Route = createFileRoute('/setup')({ component: SetupRoute })

function SetupRoute() {
	const { data } = Root.useLoaderData()
	if (data.page !== 'setup') throw new Error('Setup document data required')
	return <Setup data={data} />
}
