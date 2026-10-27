import type { WorkflowRecord } from '../jobs/workflow-types.ts'
import type { WorkflowView } from '#universal/loader-data.ts'

export function workflowView(workflow: WorkflowRecord): WorkflowView {
	return {
		id: workflow.id,
		sourceType: workflow.sourceType,
		packageId: workflow.packageId,
		workflowName: workflow.workflowName,
		exportName: workflow.exportName,
		idempotencyKey: workflow.idempotencyKey,
		status: workflow.status,
		attempts: workflow.attempts,
		runAt: workflow.runAt,
		updatedAt: workflow.updatedAt,
		lastError: workflow.lastError,
	}
}
