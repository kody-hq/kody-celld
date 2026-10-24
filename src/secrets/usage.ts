import { parseIntegrationUsage, usagePermits, type IntegrationUsage } from '../integrations/oauth.ts'

export function secretUsageFromJson(value: string | null | undefined): IntegrationUsage {
	return parseIntegrationUsage(value ? JSON.parse(value) : undefined)
}

export function allowedPackagesForSecretUsage(usage: IntegrationUsage): Array<string> {
	return usage.mode === 'packages' ? usage.packages : []
}

export function addSecretPackageGrant(usage: IntegrationUsage, packageName: string): IntegrationUsage {
	if (usage.mode === 'any') return { mode: 'packages', packages: [packageName] }
	return usage.packages.includes(packageName) ? usage : { mode: 'packages', packages: [...usage.packages, packageName] }
}

export function removeSecretPackageGrant(usage: IntegrationUsage, packageName: string): IntegrationUsage {
	if (usage.mode === 'any') return usage
	const packages = usage.packages.filter((name) => name !== packageName)
	return packages.length > 0 ? { mode: 'packages', packages } : { mode: 'any' }
}

export function secretUsagePermitsPackage(usage: IntegrationUsage, packageName: string | null): boolean {
	return packageName === null || usagePermits(usage, packageName)
}

export function secretApprovalUrl(publicUrl: string, name: string, packageName: string): string {
	return `${publicUrl.replace(/\/+$/, '')}/account/secrets/approve?${new URLSearchParams({ name, package: packageName })}`
}
