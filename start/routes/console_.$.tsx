import { createFileRoute } from '@tanstack/react-router'
import { ConsolePage } from '../pages/console.tsx'
export const Route = createFileRoute('/console_/$')({ component: ConsolePage })
