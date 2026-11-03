/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { CommunityDetail, CommunityNotFound } from '../pages/community.tsx'
import { Route as Root } from './__root.tsx'

export const Route = createFileRoute('/community_/$')({
	component: CommunityDetailRoute,
})

function CommunityDetailRoute() {
	const { data } = Root.useLoaderData()
	if (data.page === 'communityNotFound') return <CommunityNotFound data={data} />
	if (data.page !== 'communityDetail') throw new Error('Community package data required')
	return <CommunityDetail data={data} />
}
