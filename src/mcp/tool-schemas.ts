export const searchToolSchema = {
	type: 'object',
	properties: {
		query: { type: 'string', description: 'Free-text query. Empty lists everything.' },
		entity: {
			type: 'string',
			enum: ['capability', 'domain', 'package', 'job', 'guide', 'mcp-server'],
			description: 'Restrict to one entity kind.',
		},
		domain: { type: 'string', description: 'Restrict to one domain (system, secrets, packages, jobs, storage, runs).' },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
		maxResponseSize: { type: 'integer', minimum: 1000, default: 20000 },
		conversationId: { type: 'string', description: 'Accepted for Kody compatibility; unused.' },
		memoryContext: { type: 'string', description: 'Accepted for Kody compatibility; unused.' },
		includeHiddenPackages: { type: 'boolean', default: false },
	},
}
