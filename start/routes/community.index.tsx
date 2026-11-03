/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { Community } from '../pages/community.tsx'
import { Route as Root } from './__root.tsx'

export const Route = createFileRoute('/community/')({
	component: CommunityRoute,
})

function CommunityRoute() {
	const { data } = Root.useLoaderData()
	if (data.page !== 'community') throw new Error('Community catalog data required')
	return <Community data={data} />
}
