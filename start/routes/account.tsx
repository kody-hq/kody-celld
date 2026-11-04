import { createFileRoute } from '@tanstack/react-router'
import { AccountPage } from '../pages/account-page.tsx'

export const Route = createFileRoute('/account')({ component: AccountPage })
