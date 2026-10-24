import { routes } from '#universal/routes.ts'
import { clearCookie, cookiesAreSecure, readCookie, serializeCookie } from '../auth/cookies.ts'
import { getUserCell } from '../execute/engine.ts'
import type { Env } from '../env.ts'
import { recordAudit } from '../lib/audit.ts'
import { canonicalJsonStringify } from '../lib/canonical-json.ts'
import { sha256Hex } from '../lib/crypto.ts'
import { KodyError } from '../lib/errors.ts'
import { normalizeSecretHost } from '../secrets/host-policy.ts'
import { appSessionOf, readForm, redirect } from './http.ts'
import { assertCsrf, readWebSession, type WebSession } from './session.ts'

export type ConnectSecretSetPageData = {
	page: 'connectSecretSet'
	csrf: string
	name: string
	description: string | null
	scope: 'user' | 'package'
	packageId: string | null
	hosts: Array<string>
	unsupportedNote: string | null
	error: string | null
	saved: boolean
	canSubmit: boolean
}

type ConnectSecretSetSetup = Omit<ConnectSecretSetPageData, 'page' | 'csrf' | 'error' | 'saved' | 'canSubmit'>

const savedCookieName = 'kody_connect_saved'
const savedCookiePath = routes.connectSecretSet.href()

export type ConnectSecretSetQuery =
	{ kind: 'missing_name' } | { kind: 'setup'; setup: ConnectSecretSetSetup; error: string | null }

export function parseConnectSecretSetQuery(url: URL): ConnectSecretSetQuery {
	const name = url.searchParams.get('name')?.trim() ?? ''
	if (!name) return { kind: 'missing_name' }

	const requestedScope = url.searchParams.get('scope')?.trim() || 'user'
	const scope = requestedScope === 'package' ? 'package' : 'user'
	const packageId = url.searchParams.get('packageId')?.trim() || null
	const description = url.searchParams.get('description')?.trim() || null
	const rawHosts = (url.searchParams.get('allowedHosts') ?? '')
		.split(',')
		.map((host) => host.trim())
		.filter(Boolean)
	const normalizedHosts: Array<string> = []
	let error: string | null = null

	if (requestedScope !== 'user' && requestedScope !== 'package') {
		error = 'Scope must be user or package.'
	} else if (scope === 'package' && !packageId) {
		error = 'Package scope requires packageId.'
	}

	for (const host of rawHosts) {
		try {
			normalizedHosts.push(normalizeSecretHost(host))
		} catch (hostError) {
			error ??= KodyError.fromUnknown(hostError)?.message ?? 'A host is not valid.'
		}
	}

	const unsupported = ['expiresAt', 'allowedPackages'].filter((key) => url.searchParams.has(key))
	return {
		kind: 'setup',
		setup: {
			name,
			description,
			scope,
			packageId,
			hosts: error && rawHosts.length > 0 ? rawHosts : [...new Set(normalizedHosts)],
			unsupportedNote:
				unsupported.length > 0
					? 'Celld does not support expiresAt or allowedPackages yet. These link options will be ignored.'
					: null,
		},
		error,
	}
}

export function isConnectSecretSetRoute(pathname: string) {
	return pathname === routes.connectSecretSet.href()
}

async function renderConnectSecretSet(
	url: URL,
	session: WebSession,
	setup: ConnectSecretSetSetup,
	input: { error?: string | null; saved?: boolean; canSubmit?: boolean; status?: number } = {},
) {
	const { renderPage } = await import('#app/render.tsx')
	const data: ConnectSecretSetPageData = {
		page: 'connectSecretSet',
		csrf: session.csrf,
		...setup,
		error: input.error ?? null,
		saved: input.saved ?? false,
		canSubmit: input.canSubmit ?? true,
	}
	return renderPage({
		title: data.saved ? 'Secret saved' : 'Set secret',
		pathname: url.pathname,
		session: appSessionOf(session),
		status: input.status,
		headers: { 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store' },
		data,
	})
}

async function connectSecretSetSavedCookieValue(
	userId: string,
	setup: Pick<ConnectSecretSetPageData, 'name' | 'scope' | 'packageId' | 'description' | 'hosts'>,
) {
	return sha256Hex(
		canonicalJsonStringify({
			userId,
			name: setup.name,
			scope: setup.scope,
			packageId: setup.packageId,
			description: setup.description,
			hosts: setup.hosts.map(normalizeSecretHost).sort(),
		}),
	)
}

export async function connectSecretSetSavedState(
	request: Request,
	userId: string,
	setup: Pick<ConnectSecretSetPageData, 'name' | 'scope' | 'packageId' | 'description' | 'hosts'> | null,
) {
	const savedCookieValue = await readCookie(request, savedCookieName)
	const expectedValue = setup ? await connectSecretSetSavedCookieValue(userId, setup) : null
	const saved = expectedValue !== null && savedCookieValue === expectedValue
	return {
		saved,
		canSubmit: !saved,
		clearCookie:
			savedCookieValue !== null
				? await clearCookie(savedCookieName, cookiesAreSecure(request.url), savedCookiePath)
				: null,
	}
}

function withSetCookie(response: Response, cookie: string | null) {
	if (!cookie) return response
	const headers = new Headers(response.headers)
	headers.append('set-cookie', cookie)
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

function savedLocation(url: URL) {
	const target = new URL(url)
	target.searchParams.delete('flash')
	return `${target.pathname}${target.search}`
}

export async function handleConnectSecretSet(request: Request, env: Env, url: URL): Promise<Response> {
	const session = await readWebSession(request, env)
	if (!session) {
		return redirect(`/signin?flash=signin_required&next=${encodeURIComponent(url.pathname + url.search)}`)
	}

	if (request.method !== 'GET' && request.method !== 'POST') {
		return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
	}

	const form = request.method === 'POST' ? await readForm(request) : {}
	if (request.method === 'POST') assertCsrf(request, env, session, form)

	const parsed = parseConnectSecretSetQuery(url)
	const savedState =
		request.method === 'GET'
			? await connectSecretSetSavedState(
					request,
					session.user.id,
					parsed.kind === 'setup' && parsed.error === null ? parsed.setup : null,
				)
			: null
	const clearSavedCookie = savedState?.clearCookie ?? null
	if (parsed.kind === 'missing_name') {
		return redirect(routes.accountSecrets.href(), clearSavedCookie ? { 'set-cookie': clearSavedCookie } : {})
	}
	const renderPage = async (setup: ConnectSecretSetSetup, input: Parameters<typeof renderConnectSecretSet>[3] = {}) =>
		withSetCookie(await renderConnectSecretSet(url, session, setup, input), clearSavedCookie)
	if (parsed.error) {
		return renderPage(parsed.setup, {
			error: parsed.error,
			canSubmit: false,
			status: 400,
		})
	}

	if (request.method === 'GET') {
		return renderPage(parsed.setup, { saved: savedState?.saved, canSubmit: savedState?.canSubmit })
	}

	const value = form.value ?? ''
	if (!value) {
		return renderPage(parsed.setup, {
			error: 'Enter a secret value.',
			status: 400,
		})
	}

	const userCell = getUserCell(env, session.user.id)
	await userCell.init(session.user.id)
	try {
		await userCell.secretSave({
			name: parsed.setup.name,
			value,
			description: parsed.setup.description ?? undefined,
			scope: parsed.setup.scope,
			...(parsed.setup.scope === 'package' && parsed.setup.packageId ? { packageName: parsed.setup.packageId } : {}),
		})
		await recordAudit(env, {
			actor: `user:${session.user.id}`,
			action: 'secret.save',
			target: parsed.setup.name,
			details: { via: 'connect' },
		})
		for (const host of parsed.setup.hosts) {
			const approved = await userCell.secretHostApprove({ host, approvedBy: 'owner' })
			await recordAudit(env, {
				actor: `user:${session.user.id}`,
				action: 'secret_host.approve',
				target: session.user.id,
				details: { host: approved.host, via: 'connect' },
			})
		}
	} catch (error) {
		const kodyError = KodyError.fromUnknown(error)
		if (kodyError && kodyError.status < 500) {
			return renderPage(parsed.setup, {
				error: kodyError.message,
				status: kodyError.status,
			})
		}
		throw error
	}

	const savedCookieValue = await connectSecretSetSavedCookieValue(session.user.id, parsed.setup)
	const savedCookie = await serializeCookie(savedCookieName, savedCookieValue, {
		maxAgeSeconds: 60,
		secure: cookiesAreSecure(request.url),
		path: savedCookiePath,
	})
	return redirect(savedLocation(url), { 'set-cookie': savedCookie })
}
