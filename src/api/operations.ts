export const apiOperations = [
	['GET', '/v1/me', 'metaGetCurrentUser'],
	['GET', '/v1/search', 'search'],
	['GET', '/v1/memories', 'metaMemorySearch'],
	['POST', '/v1/memories', 'metaMemoryUpsert'],
	['POST', '/v1/memories/verify', 'metaMemoryVerify'],
	['GET', '/v1/memories/{memory_id}', 'metaMemoryGet'],
	['DELETE', '/v1/memories/{memory_id}', 'metaMemoryDelete'],
	['GET', '/v1/secrets', 'secretList'],
	['POST', '/v1/secrets/batch', 'secretSetMany'],
	['POST', '/v1/secrets/lock', 'secretLock'],
	['POST', '/v1/secrets/jwt', 'secretJwtSign'],
	['PUT', '/v1/secrets/{scope}/{name}', 'secretSet'],
	['POST', '/v1/secrets/{scope}/{name}/disconnect', 'secretDisconnect'],
	['DELETE', '/v1/secrets/{scope}/{name}', 'secretDelete'],
	['GET', '/v1/credentials', 'credentialList'],
	['PATCH', '/v1/credentials/{credential_id}', 'credentialUpdate'],
	['GET', '/v1/secret-providers', 'secretProviderList'],
	['PUT', '/v1/secret-providers/{provider}', 'secretProviderBind'],
	['DELETE', '/v1/secret-providers/{provider}', 'secretProviderUnbind'],
	['POST', '/v1/secret-providers/{provider}/lock', 'secretProviderLock'],
	['GET', '/v1/mcp-server-instructions', 'metaGetMcpServerInstructions'],
	['PUT', '/v1/mcp-server-instructions', 'metaSetMcpServerInstructions'],
	['GET', '/v1/packages', 'packageList'],
	['POST', '/v1/packages', 'packageSave'],
	['POST', '/v1/packages/check', 'packageCheck'],
	['GET', '/v1/packages/{package_id}', 'packageGet'],
	['PATCH', '/v1/packages/{package_id}', 'packageUpdate'],
	['DELETE', '/v1/packages/{package_id}', 'packageDelete'],
	['POST', '/v1/packages/{package_id}/security-audits', 'packageSecurityAuditRecord'],
	['POST', '/v1/packages/{package_id}/external-push', 'packagePublishExternalPush'],
	['GET', '/v1/package-subscriptions', 'packageSubscriptionsList'],
	['GET', '/v1/enablements', 'enablementList'],
	['POST', '/v1/enablements', 'enablementEnable'],
	['POST', '/v1/enablements/{enablementId}/disable', 'enablementDisable'],
	['GET', '/v1/approvals', 'approvalPendingList'],
	['POST', '/v1/approval-bundles', 'approvalBundleCreate'],
	['GET', '/v1/jobs', 'jobList'],
	['GET', '/v1/jobs/{id}', 'jobGet'],
	['PATCH', '/v1/jobs/{id}', 'jobUpdate'],
	['POST', '/v1/jobs/{id}/run', 'jobRunNow'],
	['GET', '/v1/workflow-runs', 'workflowRunList'],
	['POST', '/v1/workflow-runs/{id}/cancel', 'workflowRunCancel'],
	['GET', '/v1/webhooks', 'webhookList'],
	['POST', '/v1/webhooks/apply', 'webhookUrlApply'],
	['POST', '/v1/webhooks/{webhookName}/url', 'webhookUrlMint'],
	['POST', '/v1/webhooks/{webhookName}/url/rotate', 'webhookUrlRotate'],
	['POST', '/v1/webhooks/{webhookName}/enable', 'webhookEnable'],
	['POST', '/v1/webhooks/{webhookName}/disable', 'webhookDisable'],
	['GET', '/v1/webhooks/{webhookName}/deliveries', 'webhookDeliveryList'],
	['GET', '/v1/email/inboxes', 'emailInboxList'],
	['GET', '/v1/email/messages', 'emailMessageList'],
	['GET', '/v1/email/messages/search', 'emailMessageSearch'],
	['GET', '/v1/email/messages/{message_id}', 'emailMessageGet'],
	['DELETE', '/v1/email/messages/{message_id}', 'emailMessageDelete'],
	['POST', '/v1/email/messages/{message_id}/classify', 'emailMessageClassify'],
	['POST', '/v1/email/messages/{message_id}/reply', 'emailReply'],
	['POST', '/v1/email/send', 'emailSend'],
	['GET', '/v1/email/attachments/{attachment_id}', 'emailAttachmentGet'],
	['GET', '/v1/email/delivery-events', 'emailDeliveryEventList'],
	['GET', '/v1/email/sender-rules', 'emailSenderRuleList'],
	['POST', '/v1/email/sender-rules', 'emailSenderRuleSet'],
	['DELETE', '/v1/email/sender-rules/{rule_id}', 'emailSenderRuleDelete'],
	['GET', '/v1/email/destinations', 'emailDestinationList'],
	['POST', '/v1/email/destinations', 'emailDestinationAdd'],
	['DELETE', '/v1/email/destinations/{id}', 'emailDestinationRemove'],
	['POST', '/v1/email/destinations/{id}/default', 'emailDestinationSetDefault'],
	['GET', '/v1/integrations', 'integrationList'],
	['POST', '/v1/integrations/device/start', 'integrationDeviceConnectStart'],
	['POST', '/v1/integrations/device/poll', 'integrationDeviceConnectPoll'],
	['GET', '/v1/integrations/{name}', 'integrationGet'],
	['PUT', '/v1/integrations/{name}', 'integrationSave'],
	['DELETE', '/v1/integrations/{name}', 'integrationDelete'],
	['POST', '/v1/integrations/{name}/lock', 'integrationLock'],
	['POST', '/v1/integrations/{name}/refresh', 'integrationTokenRefresh'],
	['GET', '/v1/oauth-apps', 'integrationOauthAppList'],
	['DELETE', '/v1/oauth-apps/{slug}', 'integrationOauthAppDelete'],
	['POST', '/v1/oauth-apps/{slug}/rotate-credentials', 'integrationOauthAppRotateCredentials'],
	['GET', '/v1/platform-apps', 'integrationPlatformAppList'],
	['GET', '/v1/mcp-servers', 'mcpServerList'],
	['POST', '/v1/mcp-servers', 'mcpServerAdd'],
	['DELETE', '/v1/mcp-servers/{server}', 'mcpServerRemove'],
	['PUT', '/v1/mcp-servers/{server}/enabled', 'mcpServerSetEnabled'],
	['POST', '/v1/mcp-servers/{server}/reconnect', 'mcpServerReconnect'],
	['POST', '/v1/mcp-servers/{server}/refresh', 'mcpServerRefresh'],
	['POST', '/v1/mcp-servers/{server}/lock', 'mcpServerLock'],
	['GET', '/v1/runs', 'runList'],
	['GET', '/v1/runs/summary', 'runSummary'],
	['POST', '/v1/runs/triage', 'runUpdateBulk'],
	['GET', '/v1/runs/{run_id}', 'runGet'],
	['PATCH', '/v1/runs/{run_id}', 'runUpdate'],
	['GET', '/v1/storage/{storage_id}/export', 'storageExport'],
	['POST', '/v1/storage/{storage_id}/query', 'storageQuery'],
	['GET', '/v1/community/listings', 'communitySearch'],
	['POST', '/v1/community/listings', 'communityPublish'],
	['GET', '/v1/community/listings/{listing_id}', 'communityGet'],
	['DELETE', '/v1/community/listings/{listing_id}', 'communityUnpublish'],
	['POST', '/v1/community/listings/{listing_id}/fork', 'communityFork'],
	['POST', '/v1/community/listings/{listing_id}/rate', 'communityRate'],
	['POST', '/v1/community/listings/{listing_id}/report', 'communityReport'],
	['POST', '/v1/community/fork-adopt', 'communityForkAdopt'],
	['GET', '/v1/community/profile', 'communityProfileGet'],
	['PATCH', '/v1/community/profile', 'communityProfileUpdate'],
	['POST', '/v1/execute', 'execute'],
] as const

export type ApiMethod = (typeof apiOperations)[number][0]
export type ApiOperation = (typeof apiOperations)[number]
export type ApiOperationId = ApiOperation[2]

export const apiOperationOptions: Partial<
	Record<ApiOperationId, { pathParams?: Record<string, string>; omitInputs?: Array<string> }>
> = {
	search: { omitInputs: ['memoryContext'] },
	packageGet: { pathParams: { package_id: 'name' } },
	packageUpdate: { pathParams: { package_id: 'name' } },
	packageDelete: { pathParams: { package_id: 'name' } },
	packageSecurityAuditRecord: { pathParams: { package_id: 'name' } },
	packagePublishExternalPush: { pathParams: { package_id: 'name' } },
	metaMemoryGet: { pathParams: { memory_id: 'id' } },
	metaMemoryDelete: { pathParams: { memory_id: 'id' } },
	secretProviderBind: { pathParams: { provider: 'providerId' } },
	secretProviderUnbind: { pathParams: { provider: 'providerId' } },
	secretProviderLock: { pathParams: { provider: 'providerId' } },
	webhookUrlRotate: { pathParams: { webhookName: 'handle' } },
	webhookEnable: { pathParams: { webhookName: 'handle' } },
	webhookDisable: { pathParams: { webhookName: 'handle' } },
	webhookDeliveryList: { pathParams: { webhookName: 'handle' } },
	emailMessageGet: { pathParams: { message_id: 'id' } },
	emailMessageDelete: { pathParams: { message_id: 'id' } },
	emailReply: { pathParams: { message_id: 'id' } },
	emailAttachmentGet: { pathParams: { attachment_id: 'attachmentId' } },
	emailSenderRuleDelete: { pathParams: { rule_id: 'id' } },
	emailDestinationRemove: { pathParams: { id: 'address' } },
	emailDestinationSetDefault: { pathParams: { id: 'address' } },
	mcpServerRemove: { pathParams: { server: 'name' } },
	mcpServerSetEnabled: { pathParams: { server: 'name' } },
	mcpServerRefresh: { pathParams: { server: 'name' } },
	mcpServerLock: { pathParams: { server: 'name' } },
	communityGet: { pathParams: { listing_id: 'name' } },
	communityUnpublish: { pathParams: { listing_id: 'name' } },
	runGet: { pathParams: { run_id: 'id' } },
	runUpdate: { pathParams: { run_id: 'runId' } },
}

const nativeOperations = new Set<ApiOperationId>(['search', 'execute'])

export function getAvailableApiOperations(capabilityNames: Iterable<string>): Array<ApiOperation> {
	const names = new Set(capabilityNames)
	return apiOperations.filter((operation) => nativeOperations.has(operation[2]) || names.has(operation[2]))
}

type MatchedRoute = {
	operation: ApiOperation
	pathParams: Record<string, string>
}

export type ApiRouteMatch =
	{ kind: 'match'; route: MatchedRoute } | { kind: 'not_found' } | { kind: 'method_not_allowed'; allow: Array<string> }

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
	const expected = pattern.split('/').filter(Boolean)
	const actual = pathname.split('/').filter(Boolean)
	if (expected.length !== actual.length) return null
	const params: Record<string, string> = {}
	for (let index = 0; index < expected.length; index++) {
		const segment = expected[index]!
		const value = actual[index]!
		const parameter = /^\{([^{}]+)\}$/.exec(segment)
		if (!parameter) {
			if (segment !== value) return null
			continue
		}
		try {
			const decoded = decodeURIComponent(value)
			if (!decoded) return null
			params[parameter[1]!] = decoded
		} catch {
			return null
		}
	}
	return params
}

export function matchApiRoute(
	method: string,
	pathname: string,
	operations: Array<ApiOperation> = [...apiOperations],
): ApiRouteMatch {
	const matches = operations
		.map((operation) => ({ operation, pathParams: matchPath(operation[1], pathname) }))
		.filter(
			(match): match is { operation: ApiOperation; pathParams: Record<string, string> } => match.pathParams !== null,
		)
		.sort(
			(a, b) =>
				b.operation[1].split('/').filter((part) => !part.startsWith('{')).length -
				a.operation[1].split('/').filter((part) => !part.startsWith('{')).length,
		)
	if (matches.length === 0) return { kind: 'not_found' }
	const forMethod = matches
		.filter(({ operation }) => operation[0] === method.toUpperCase())
		.sort(
			(a, b) =>
				b.operation[1].split('/').filter((part) => !part.startsWith('{')).length -
				a.operation[1].split('/').filter((part) => !part.startsWith('{')).length,
		)
	const match = forMethod[0]
	if (match) return { kind: 'match', route: match }
	return {
		kind: 'method_not_allowed',
		allow: [...new Set(matches.map(({ operation }) => operation[0]))],
	}
}
