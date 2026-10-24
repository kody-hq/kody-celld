export const apiOperations = [
	['GET', '/v1/me', 'metaGetCurrentUser'],
	['GET', '/v1/search', 'search'],
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
	['GET', '/v1/runs', 'runList'],
	['GET', '/v1/runs/summary', 'runSummary'],
	['POST', '/v1/runs/triage', 'runUpdateBulk'],
	['GET', '/v1/runs/{run_id}', 'runGet'],
	['PATCH', '/v1/runs/{run_id}', 'runUpdate'],
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
