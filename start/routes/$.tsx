import { createFileRoute } from '@tanstack/react-router'
import { ErrorDocument } from '../pages/error-document.tsx'

export const Route = createFileRoute('/$')({ component: ErrorDocument })
