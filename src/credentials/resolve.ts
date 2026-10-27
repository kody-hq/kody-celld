import type { CredentialKind, CredentialSlot } from '../packages/manifest.ts'
import { KodyError } from '../lib/errors.ts'
import { usagePermits, type IntegrationUsage } from '../integrations/oauth.ts'

export type CredentialCandidate =
	| {
			kind: 'secret'
			name: string
			scope: 'user' | 'package'
			packageName: string | null
			hosts: Array<string>
	  }
	| {
			kind: 'oauth'
			name: string
			provider: string
			status: string
			flow?: string
			usage: IntegrationUsage
			hosts: Array<string>
	  }
	| {
			kind: 'mcp'
			name: string
			enabled: boolean
			usage: IntegrationUsage
			hosts: Array<string>
	  }

function isLocked(candidate: CredentialCandidate, packageName: string | null) {
	return (candidate.kind === 'oauth' || candidate.kind === 'mcp') && !usagePermits(candidate.usage, packageName)
}

export type CredentialClientInfo = {
	name: string
	scope: 'user' | 'package'
	kind: 'secret' | 'oauth' | 'mcp'
	hosts: Array<string>
}

export type ResolveCredentialInput = {
	key?: string
	name?: string
	scope?: string | null
	packageName: string | null
	slot?: Pick<CredentialSlot, 'kind' | 'provider' | 'multiple'> | null
	candidates: Array<CredentialCandidate>
	publicUrl: string
	all?: boolean
}

const supportedKinds: Array<CredentialKind> = ['secret', 'oauth', 'mcp']
const kindOrder = { secret: 0, oauth: 1, mcp: 2 }

export function resolveCredentials(input: ResolveCredentialInput): CredentialClientInfo | Array<CredentialClientInfo> {
	if (typeof input.key !== 'string' && typeof input.name !== 'string') {
		throw new KodyError('invalid_args', 'credentialOpen needs a key or name.')
	}
	const target = input.name ?? input.key ?? ''
	const slotKind = input.slot?.kind
	if (slotKind && !supportedKinds.includes(slotKind)) {
		throw new KodyError('credential_unsupported', `Credential kind "${slotKind}" is not supported on celld yet.`)
	}
	if (input.all && input.slot?.multiple !== true) {
		throw new KodyError('credential_unsupported', 'credentials(key) requires a manifest slot with multiple: true.')
	}
	const requestedScope =
		input.scope === 'personal' || input.scope === 'org' ? 'user' : input.scope === 'user' ? 'user' : input.scope
	if (
		requestedScope !== undefined &&
		requestedScope !== null &&
		requestedScope !== 'user' &&
		requestedScope !== 'package'
	) {
		throw new KodyError('invalid_args', 'scope must be user, package, personal, or org.')
	}
	const provider = input.slot?.provider ?? input.key
	const matches = input.candidates
		.filter((candidate) => {
			if (slotKind && candidate.kind !== slotKind) return false
			if (candidate.kind === 'secret' && candidate.scope === 'package' && candidate.packageName !== input.packageName) {
				return false
			}
			if (input.name !== undefined) {
				if (candidate.name !== input.name) return false
				const candidateScope = candidate.kind === 'secret' ? candidate.scope : 'user'
				if (requestedScope && candidateScope !== requestedScope) return false
			} else if (candidate.kind === 'oauth') {
				if (candidate.name !== input.key && candidate.provider !== provider) return false
			} else if (candidate.name !== input.key) {
				return false
			}
			if (candidate.kind === 'oauth' && candidate.status !== 'connected' && candidate.flow !== 'client_credentials') {
				return false
			}
			if (candidate.kind === 'mcp' && !candidate.enabled) return false
			return true
		})
		.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name))
	const locked = matches.find((candidate) => isLocked(candidate, input.packageName))
	const permitted = matches.filter((candidate) => !isLocked(candidate, input.packageName))
	if (locked && permitted.length === 0) {
		throw new KodyError('credential_denied', `Credential "${locked.name}" is locked to other packages.`, {
			status: 403,
		})
	}
	matches.splice(0, matches.length, ...permitted)
	if (matches.length === 0) {
		const createUrl = `${input.publicUrl.replace(/\/$/, '')}/account/secrets`
		throw new KodyError('credential_unbound', `No credential matches "${target}". Create one at ${createUrl}.`, {
			status: 404,
			details: { createUrl },
		})
	}
	if (input.all) return matches.map(toClientInfo)
	if (matches.length > 1) {
		throw new KodyError(
			'credential_ambiguous',
			`More than one credential matches "${target}". Choose one by name and scope.`,
			{
				status: 409,
				details: {
					options: matches.map((candidate) => ({
						name: candidate.name,
						scope: candidate.kind === 'secret' ? candidate.scope : 'user',
						kind: candidate.kind,
					})),
					retryWith: ['credential.named(name, { scope })', 'credentials(key)'],
				},
			},
		)
	}
	return toClientInfo(matches[0] as CredentialCandidate)
}

function toClientInfo(candidate: CredentialCandidate): CredentialClientInfo {
	return {
		name: candidate.name,
		scope: candidate.kind === 'secret' ? candidate.scope : 'user',
		kind: candidate.kind,
		hosts: [...candidate.hosts],
	}
}
