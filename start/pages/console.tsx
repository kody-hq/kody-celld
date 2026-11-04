/** @jsxImportSource @emotion/react */
import { Route as Root } from '../routes/__root.tsx'
import { AdminLogin } from './admin-login.tsx'
import { AdminUsers } from './admin-users.tsx'
import { AdminUserDetail } from './admin-user-detail.tsx'
import { AdminAudit } from './admin-audit.tsx'
import { AdminConfig } from './admin-config.tsx'
export function ConsolePage() {
	const { data, pathname } = Root.useLoaderData()
	switch (data.page) {
		case 'adminLogin':
			return <AdminLogin />
		case 'adminUsers':
			return <AdminUsers data={data} pathname={pathname} />
		case 'adminUserDetail':
			return <AdminUserDetail data={data} pathname={pathname} />
		case 'adminAudit':
			return <AdminAudit data={data} pathname={pathname} />
		case 'adminConfig':
			return <AdminConfig data={data} pathname={pathname} />
		default:
			throw new Error('Console document data required')
	}
}
