/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { ConnectSecretSet } from '../pages/connect-secret-set.tsx'
import { Route as Root } from './__root.tsx'

export const Route = createFileRoute('/connect/secret-set')({ component: ConnectSecretSetRoute })

function ConnectSecretSetRoute() {
	const { data } = Root.useLoaderData()
	if (data.page !== 'connectSecretSet') throw new Error('Secret connect document data required')
	return <ConnectSecretSet data={data} />
}
