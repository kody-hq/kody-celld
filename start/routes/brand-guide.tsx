/** @jsxImportSource @emotion/react */
import { createFileRoute } from '@tanstack/react-router'
import { BrandGuideRoute } from '../pages/brand-guide.tsx'

export const Route = createFileRoute('/brand-guide')({
	component: BrandGuideRoute,
})
