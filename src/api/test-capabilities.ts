import type { CapabilityDefinition, JsonSchema } from '../capabilities/define.ts'

type ApiCapabilityFixture = Pick<CapabilityDefinition, 'name' | 'inputSchema' | 'readOnly'>

function capability(name: string, properties: Array<string>, readOnly = false): ApiCapabilityFixture {
	const inputSchema: JsonSchema = {
		type: 'object',
		properties: Object.fromEntries(properties.map((property) => [property, { type: 'string' }])),
	}
	return { name, inputSchema, readOnly }
}

export const registeredRouteCapabilities = [
	capability('metaMemorySearch', ['query'], true),
	capability('metaMemoryUpsert', ['subject', 'summary']),
	capability('metaMemoryVerify', ['subject', 'summary'], true),
	capability('metaMemoryGet', ['id'], true),
	capability('metaMemoryDelete', ['id']),
	capability('secretList', [], true),
	capability('secretDelete', ['name', 'scope', 'packageName']),
	capability('secretProviderList', [], true),
	capability('secretProviderBind', ['providerId', 'packageName', 'doorSecretName', 'config', 'locked']),
	capability('secretProviderUnbind', ['providerId']),
	capability('secretProviderLock', ['providerId', 'locked']),
	capability('webhookList', ['packageName'], true),
	capability('webhookUrlApply', ['target']),
	capability('webhookUrlMint', ['webhookName', 'packageName']),
	capability('webhookUrlRotate', ['handle']),
	capability('webhookEnable', ['handle']),
	capability('webhookDisable', ['handle']),
	capability('webhookDeliveryList', ['handle', 'limit'], true),
	capability('emailInboxList', [], true),
	capability('emailMessageList', ['direction', 'classification', 'inboxAddress', 'limit'], true),
	capability('emailMessageSearch', ['query', 'direction', 'limit'], true),
	capability('emailMessageGet', ['id'], true),
	capability('emailMessageDelete', ['id']),
	capability('emailReply', ['id', 'text', 'html', 'subject', 'attachments', 'headers']),
	capability('emailSend', ['subject', 'to', 'cc', 'text', 'html', 'from', 'replyTo', 'headers', 'attachments']),
	capability('emailAttachmentGet', ['messageId', 'attachmentId'], true),
	capability('emailDeliveryEventList', ['id'], true),
	capability('emailSenderRuleList', [], true),
	capability('emailSenderRuleSet', ['kind', 'value', 'effect', 'note']),
	capability('emailSenderRuleDelete', ['id']),
	capability('emailDestinationList', [], true),
	capability('emailDestinationAdd', ['address']),
	capability('emailDestinationRemove', ['address']),
	capability('emailDestinationSetDefault', ['address']),
	capability('integrationList', [], true),
	capability('integrationGet', ['name'], true),
	capability('integrationSave', ['name', 'tokenUrl', 'clientId', 'allowedHosts']),
	capability('integrationDelete', ['name']),
	capability('integrationTokenRefresh', ['name']),
	capability('mcpServerList', [], true),
	capability('mcpServerAdd', ['name', 'url']),
	capability('mcpServerRemove', ['name']),
	capability('mcpServerSetEnabled', ['name', 'enabled']),
	capability('mcpServerReconnect', ['name', 'server']),
	capability('mcpServerRefresh', ['name']),
	capability('mcpServerLock', ['name', 'packageName']),
	capability('communitySearch', ['query', 'limit'], true),
	capability('communityGet', ['name', 'includeFiles'], true),
	capability('communityPublish', ['name', 'publisher']),
	capability('communityUnpublish', ['name']),
] satisfies Array<ApiCapabilityFixture>
