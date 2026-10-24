import { WorkerEntrypoint } from 'cloudflare:workers'
import { recordAppFailure } from '../apps/run-report.ts'
import type { CapabilityContext } from '../capabilities/define.ts'
import { mcpDeps } from '../capabilities/mcp-servers.ts'
import { runCapability } from '../capabilities/registry.ts'
import { packageStorageCellName, type StorageListOptions } from '../cells/package-storage-cell.ts'
import type { CredentialCandidate } from '../credentials/resolve.ts'
import { resolveCredentials } from '../credentials/resolve.ts'
import type { Env } from '../env.ts'
import { errorToJson, KodyError } from '../lib/errors.ts'
import { callMcpTool } from '../mcp-client/service.ts'

export type RuntimeProps = { userId: string; email: string; packageName: string | null }
type CallContext = {
	runId?: string
	packageName?: string | null
	eventDepth?: number
	computedImportDepth?: number
	timeoutMs?: number
} | null
const credentialNamePattern = /^[a-zA-Z0-9._-]{1,64}$/
const credentialErrorDetailsMarker = '\n__kody_credential_error_details__:'

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/**
 * The `KODY` service binding inside every sandbox isolate. User identity comes
 * from `ctx.props` (set by the host when the isolate was loaded), so sandbox
 * code can never reach another user's cells. Storage cells are keyed by
 * (user, package); the package name comes from the stamped `packageStorage()`
 * call in the declaring module.
 */
export class RuntimeHost extends WorkerEntrypoint<Env, RuntimeProps> {
	private storage(packageName: unknown) {
		if (typeof packageName !== 'string' || !packageNamePattern.test(packageName)) {
			throw new KodyError('no_package_context', 'packageStorage() is only available inside saved package code.')
		}
		return this.env.PACKAGE_STORAGE.getByName(packageStorageCellName(this.ctx.props.userId, packageName))
	}

	private capabilityContext(call: CallContext): CapabilityContext {
		return {
			env: this.env,
			exports: this.ctx.exports,
			user: { id: this.ctx.props.userId, email: this.ctx.props.email },
			userCell: this.env.USER.getByName(this.ctx.props.userId),
			packageName: this.ctx.props.packageName,
			runId: call?.runId ?? null,
			eventDepth: call?.eventDepth ?? 0,
			computedImportDepth: call?.computedImportDepth ?? 0,
			timeoutMs: call?.timeoutMs,
			waitUntil: (promise) => this.ctx.waitUntil(promise),
			baseUrl: this.env.KODY_PUBLIC_URL,
			fromRuntime: true,
		}
	}

	async capability(name: string, args: unknown, call: CallContext) {
		try {
			return await runCapability(name, args, this.capabilityContext(call))
		} catch (error) {
			// RPC serializes plain Errors only; keep the Kody error code in the message.
			const json = errorToJson(error)
			throw new Error(`${json.error}: ${json.message}`, { cause: error })
		}
	}

	async credentialOpen(input: unknown, _call: CallContext) {
		try {
			if (typeof input !== 'object' || input === null || Array.isArray(input)) {
				throw new KodyError('invalid_args', 'credentialOpen input must be an object.')
			}
			const request = input as Record<string, unknown>
			const key = typeof request.key === 'string' ? request.key : undefined
			const name = typeof request.name === 'string' ? request.name : undefined
			if ((request.key !== undefined && key === undefined) || (request.name !== undefined && name === undefined)) {
				throw new KodyError('invalid_args', 'credentialOpen key and name must be strings.')
			}
			if (key !== undefined && name !== undefined) {
				throw new KodyError('invalid_args', 'credentialOpen accepts key or name, not both.')
			}
			if (
				(key !== undefined && !credentialNamePattern.test(key)) ||
				(name !== undefined && !credentialNamePattern.test(name))
			) {
				throw new KodyError('invalid_args', 'Credential names may contain letters, digits, ".", "_", and "-".')
			}
			if (request.all !== undefined && typeof request.all !== 'boolean') {
				throw new KodyError('invalid_args', 'credentialOpen all must be a boolean.')
			}
			if (request.scope !== undefined && request.scope !== null && typeof request.scope !== 'string') {
				throw new KodyError('invalid_args', 'credentialOpen scope must be a string.')
			}
			const userCell = this.env.USER.getByName(this.ctx.props.userId)
			const packageName = this.ctx.props.packageName
			const [manifest, secrets, secretHosts, integrations, servers] = await Promise.all([
				key && packageName ? userCell.packageManifest(packageName) : null,
				userCell.secretList(),
				userCell.secretHostList(),
				userCell.integrationList(),
				userCell.mcpServerList(),
			])
			const mcpServers = servers as Array<{
				name: string
				enabled: boolean
				usage: Extract<CredentialCandidate, { kind: 'mcp' }>['usage']
				url: string
			}>
			const candidates: Array<CredentialCandidate> = [
				...secrets.map((secret) => ({
					kind: 'secret' as const,
					name: secret.name,
					scope: secret.scope === 'package' ? ('package' as const) : ('user' as const),
					packageName: secret.packageName,
					hosts: secretHosts.map(({ host }) => host),
				})),
				...integrations.map((integration) => ({
					kind: 'oauth' as const,
					name: integration.name,
					provider: integration.provider,
					status: integration.status,
					flow: integration.flow,
					usage: integration.usage,
					hosts: integration.allowedHosts,
				})),
				...mcpServers.map((server) => ({
					kind: 'mcp' as const,
					name: server.name,
					enabled: server.enabled,
					usage: server.usage,
					hosts: (() => {
						try {
							return [new URL(server.url).hostname]
						} catch {
							return []
						}
					})(),
				})),
			]
			return resolveCredentials({
				key,
				name,
				scope: typeof request.scope === 'string' ? request.scope : request.scope === null ? null : undefined,
				packageName,
				slot: key ? manifest?.credentials[key] : undefined,
				candidates,
				publicUrl: this.env.KODY_PUBLIC_URL,
				all: request.all === true,
			})
		} catch (error) {
			const json = errorToJson(error)
			const details = KodyError.fromUnknown(error)?.details
			throw new Error(
				`${json.error}: ${json.message}${details ? `${credentialErrorDetailsMarker}${JSON.stringify(details)}` : ''}`,
				{ cause: error },
			)
		}
	}

	/** `kody.mcp[server][tool](args)`: a host-side call to a user-added MCP server, logged as a gateway event. */
	async mcpCall(server: string, tool: string, args: unknown, call: CallContext) {
		const started = Date.now()
		const userCell = this.env.USER.getByName(this.ctx.props.userId)
		const record = (event: {
			outcome: 'forwarded' | 'injected' | 'denied' | 'error'
			url: string
			secrets: Array<string>
			reason?: string
		}) => {
			if (!call?.runId) return
			let host = ''
			let url = event.url
			try {
				const parsed = new URL(event.url)
				host = parsed.hostname
				url = `${parsed.origin}${parsed.pathname}`
			} catch {}
			this.ctx.waitUntil(
				userCell.runRecordGatewayEvent({
					runId: call.runId,
					event: {
						at: new Date().toISOString(),
						method: 'MCP',
						host,
						status: null,
						mcp: { server, tool, ms: Date.now() - started },
						...event,
						url,
					},
				}),
			)
		}
		try {
			const result = await callMcpTool(mcpDeps({ env: this.env, userCell }), {
				server,
				tool,
				args,
				packageName: this.ctx.props.packageName,
			})
			const injected = result.authKind !== 'none'
			record({
				outcome: injected ? 'injected' : 'forwarded',
				url: result.url,
				secrets: injected ? [`mcp:${server}`] : [],
			})
			const { authKind: _authKind, url: _url, ...publicResult } = result
			return publicResult
		} catch (error) {
			const json = errorToJson(error)
			record({
				outcome: json.error.startsWith('mcp_server') || json.error === 'mcp_host_not_allowed' ? 'denied' : 'error',
				url: '',
				secrets: [],
				reason: json.error,
			})
			throw new Error(`${json.error}: ${json.message}`, { cause: error })
		}
	}

	/** Package-app wrapper: a thrown handler or a >= 500 response becomes an `app` error run. */
	async appRunReport(input: { status: number; error: { name: string; message: string } | null; logs: Array<unknown> }) {
		const packageName = this.ctx.props.packageName
		if (!packageName) return
		const status = typeof input?.status === 'number' ? input.status : 500
		const error =
			input?.error && typeof input.error.name === 'string' && typeof input.error.message === 'string'
				? { name: input.error.name.slice(0, 200), message: input.error.message.slice(0, 2000) }
				: { name: 'app_http_error', message: `The app responded ${status}.` }
		await recordAppFailure(this.env, {
			userId: this.ctx.props.userId,
			packageName,
			error,
			logs: Array.isArray(input?.logs) ? input.logs : [],
		})
	}

	async storageGet(packageName: string, key: string): Promise<unknown> {
		const text = await this.storage(packageName).get(key)
		return text === undefined ? undefined : (JSON.parse(text) as unknown)
	}

	async storageSet(packageName: string, key: string, value: unknown) {
		await this.storage(packageName).set(key, value === undefined ? undefined : JSON.stringify(value))
	}

	async storageDelete(packageName: string, key: string) {
		return this.storage(packageName).delete(key)
	}

	async storageList(packageName: string, options: StorageListOptions) {
		const page = await this.storage(packageName).list(options)
		return {
			cursor: page.cursor,
			items: page.items.map((item) => ({
				key: item.key,
				value: JSON.parse(item.valueJson) as unknown,
				updatedAt: item.updatedAt,
			})),
		}
	}

	async storageClear(packageName: string) {
		await this.storage(packageName).clear()
	}

	async storageSql(packageName: string, query: string, params: Array<unknown>) {
		const bound = params.map((value): SqlStorageValue => {
			if (value === null || value === undefined) return null
			if (typeof value === 'number' || typeof value === 'string') return value
			if (typeof value === 'boolean') return value ? 1 : 0
			if (value instanceof ArrayBuffer) return value
			return JSON.stringify(value)
		})
		return this.storage(packageName).sql(query, bound)
	}
}
