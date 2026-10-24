import { KodyError } from '../lib/errors.ts'
import { validateArgs, type CapabilityContext, type CapabilityDefinition } from './define.ts'

export function createCapabilityRegistry(capabilities: Array<CapabilityDefinition>) {
	const byName = new Map<string, CapabilityDefinition>()
	for (const capability of capabilities) {
		for (const name of [capability.name, ...(capability.aliases ?? [])]) {
			if (byName.has(name)) throw new Error(`Capability name "${name}" is declared more than once.`)
			byName.set(name, capability)
		}
	}

	return {
		getCapability(name: string) {
			return byName.get(name) ?? null
		},
		async runCapability(name: string, args: unknown, ctx: CapabilityContext) {
			const capability = byName.get(name)
			if (!capability) {
				throw new KodyError(
					'unknown_capability',
					`Unknown capability "${name}". Use search to discover capability ids.`,
					{ status: 404 },
				)
			}
			const validated = validateArgs(capability.inputSchema, args, name)
			return capability.handler(validated, ctx)
		},
	}
}
