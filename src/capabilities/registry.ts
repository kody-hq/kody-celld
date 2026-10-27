import type { CapabilityDefinition, DomainDefinition } from './define.ts'
import { createCapabilityRegistry } from './lookup.ts'
import { aiCapabilities, aiDomain } from './ai.ts'
import { blobCapabilities, blobsDomain } from './blobs.ts'
import { browserCapabilities, browserDomain } from './browser.ts'
import { jobCapabilities, jobsDomain } from './jobs.ts'
import { memoryCapabilities, memoryDomain } from './memory.ts'
import { packageCapabilities, packagesDomain } from './packages.ts'
import { runCapabilities, runsDomain } from './runs.ts'
import { secretCapabilities, secretsDomain } from './secrets.ts'
import { storageCapabilities, storageDomain } from './storage.ts'
import { systemCapabilities, systemDomain } from './system.ts'
import { emailCapabilities, emailDomain } from './email.ts'
import { webhookCapabilities, webhooksDomain } from './webhooks.ts'
import { integrationCapabilities, integrationsDomain } from './integrations.ts'
import { mcpServerCapabilities, mcpServersDomain } from './mcp-servers.ts'
import { secretProviderCapabilities, secretProvidersDomain } from './secret-providers.ts'
import { accountCapabilities, accountDomain } from './account.ts'
import { communityCapabilities, communityDomain } from './community.ts'
import { workflowCapabilities } from './workflows.ts'

export const domains: Array<DomainDefinition> = [
	systemDomain,
	secretsDomain,
	packagesDomain,
	jobsDomain,
	storageDomain,
	runsDomain,
	memoryDomain,
	aiDomain,
	blobsDomain,
	browserDomain,
	webhooksDomain,
	emailDomain,
	integrationsDomain,
	mcpServersDomain,
	secretProvidersDomain,
	accountDomain,
	communityDomain,
]

export const capabilities: Array<CapabilityDefinition> = [
	...systemCapabilities,
	...secretCapabilities,
	...packageCapabilities,
	...jobCapabilities,
	...storageCapabilities,
	...runCapabilities,
	...memoryCapabilities,
	...aiCapabilities,
	...blobCapabilities,
	...browserCapabilities,
	...webhookCapabilities,
	...emailCapabilities,
	...integrationCapabilities,
	...mcpServerCapabilities,
	...secretProviderCapabilities,
	...accountCapabilities,
	...communityCapabilities,
	...workflowCapabilities,
]

const capabilityRegistry = createCapabilityRegistry(capabilities)
export const getCapability = capabilityRegistry.getCapability
export const runCapability = capabilityRegistry.runCapability
