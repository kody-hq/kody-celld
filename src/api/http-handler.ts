import type { Principal } from '../auth/authenticate.ts'
import { capabilityContext } from '../capabilities/context.ts'
import type { CapabilityContext, CapabilityDefinition, JsonSchema } from '../capabilities/define.ts'
import type { Env } from '../env.ts'
import { KodyError } from '../lib/errors.ts'
import type { SearchInput } from '../mcp/search.ts'
import { searchToolSchema } from '../mcp/tool-schemas.ts'
import { buildOpenApiDocument } from './document.ts'
import { apiOperationOptions, getAvailableApiOperations, matchApiRoute } from './operations.ts'
import { maxApiRequestBodyBytes, mergeApiParams, readJsonBody, readQueryParams } from './request-params.ts'

function errorResponse(cause: unknown, pathname: string) {
	const kodyError = KodyError.fromUnknown(cause)
	if (kodyError) {
		return Response.json(
			{
				error: {
					code: kodyError.code,
					message: kodyError.message,
					...(kodyError.details === undefined ? {} : { details: kodyError.details }),
				},
			},
			{ status: kodyError.status },
		)
	}
	console.error('open-api-request-failed', pathname, cause)
	return Response.json({ error: { code: 'internal_error', message: 'Internal server error.' } }, { status: 500 })
}

function error(code: string, message: string, status: number) {
	return new KodyError(code, message, { status })
}

function openApiEtag(document: string) {
	return crypto.subtle.digest('SHA-256', new TextEncoder().encode(document)).then((digest) => {
		const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
		return `"${hash}"`
	})
}

function etagMatches(header: string | null, etag: string) {
	return (header ?? '')
		.split(',')
		.map((value) => value.trim())
		.some((value) => value === '*' || value === etag || value.replace(/^W\//, '') === etag)
}

async function handleOpenApi(request: Request, env: Env) {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return Response.json(
			{ error: { code: 'method_not_allowed', message: `Method ${request.method} is not allowed here.` } },
			{ status: 405, headers: { Allow: 'GET, HEAD' } },
		)
	}
	const capabilities = (await import('../capabilities/registry.ts')).capabilities
	const document = JSON.stringify(buildOpenApiDocument(env.KODY_PUBLIC_URL, capabilities))
	const etag = await openApiEtag(document)
	const headers = { 'Cache-Control': 'public, max-age=300', ETag: etag }
	if (etagMatches(request.headers.get('If-None-Match'), etag)) {
		return new Response(null, { status: 304, headers })
	}
	return new Response(request.method === 'HEAD' ? null : document, {
		status: 200,
		headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
	})
}

function inputSchemaFor(
	operationId: string,
	registeredCapabilities: ReadonlyArray<Pick<CapabilityDefinition, 'name' | 'inputSchema'>>,
): JsonSchema {
	if (operationId === 'search') {
		return {
			...searchToolSchema,
			properties: Object.fromEntries(
				Object.entries(searchToolSchema.properties).filter(([name]) => name !== 'memoryContext'),
			),
		}
	}
	return (
		registeredCapabilities.find((capability) => capability.name === operationId)?.inputSchema ?? {
			type: 'object',
			properties: {},
		}
	)
}

function renamedPathParams(pathParams: Record<string, string>, operationId: string) {
	const renames = apiOperationOptions[operationId as keyof typeof apiOperationOptions]?.pathParams ?? {}
	return Object.fromEntries(Object.entries(pathParams).map(([name, value]) => [renames[name] ?? name, value]))
}

async function readParams(
	request: Request,
	url: URL,
	operationId: string,
	method: string,
	registeredCapabilities: ReadonlyArray<Pick<CapabilityDefinition, 'name' | 'inputSchema'>>,
) {
	const schema = inputSchemaFor(operationId, registeredCapabilities)
	if (method === 'GET' || method === 'DELETE') return readQueryParams(url.searchParams, schema)
	const body = await readJsonBody(request)
	if (body.kind === 'too_large') {
		throw error(
			'payload_too_large',
			`Request body is ${body.byteLength} bytes; the maximum is ${maxApiRequestBodyBytes} bytes.`,
			413,
		)
	}
	if (body.kind === 'unsupported_media_type') {
		throw error('unsupported_media_type', 'Request body must be application/json.', 415)
	}
	return body.body
}

function context(env: Env, execution: ExecutionContext, auth: Principal) {
	return capabilityContext(env, execution, auth)
}

function validateExecuteApiInput(params: Record<string, unknown>) {
	const hasCode = Object.hasOwn(params, 'code')
	const hasInvoke = Object.hasOwn(params, 'invoke')
	if (hasCode === hasInvoke) throw error('invalid_input', 'Provide exactly one of "code" or "invoke".', 400)
	if (hasCode && (typeof params.code !== 'string' || !params.code.trim())) {
		throw error('invalid_input', '"code" must be a non-empty string.', 400)
	}
	if (hasInvoke && typeof params.invoke !== 'string') {
		throw error('invalid_input', '"invoke" must be a string.', 400)
	}
	if (
		params.params !== undefined &&
		(typeof params.params !== 'object' || params.params === null || Array.isArray(params.params))
	) {
		throw error('invalid_input', '"params" must be an object.', 400)
	}
	if (
		params.responseLimit !== undefined &&
		(typeof params.responseLimit !== 'number' || !Number.isInteger(params.responseLimit) || params.responseLimit < 1)
	) {
		throw error('invalid_input', '"responseLimit" must be a positive integer.', 400)
	}
	if (
		params.idempotencyKey !== undefined &&
		(typeof params.idempotencyKey !== 'string' ||
			params.idempotencyKey.length < 1 ||
			params.idempotencyKey.length > 200)
	) {
		throw error('invalid_input', '"idempotencyKey" must be between 1 and 200 characters.', 400)
	}
}

export async function handleApiRequest(request: Request, env: Env, execution: ExecutionContext): Promise<Response> {
	const url = new URL(request.url)
	if (url.pathname === '/openapi.json') {
		try {
			return await handleOpenApi(request, env)
		} catch (caught) {
			return errorResponse(caught, url.pathname)
		}
	}
	if (url.pathname !== '/v1' && !url.pathname.startsWith('/v1/')) {
		return errorResponse(
			error('not_found', `No route for ${request.method} ${url.pathname}. See /openapi.json.`, 404),
			url.pathname,
		)
	}

	const registeredCapabilities = (await import('../capabilities/registry.ts')).capabilities
	const operations = getAvailableApiOperations(registeredCapabilities.map((capability) => capability.name))
	const match = matchApiRoute(request.method, url.pathname, operations)
	if (match.kind === 'not_found') {
		return errorResponse(
			error('not_found', `No route for ${request.method} ${url.pathname}. See /openapi.json.`, 404),
			url.pathname,
		)
	}
	if (match.kind === 'method_not_allowed') {
		return new Response(
			JSON.stringify({
				error: { code: 'method_not_allowed', message: `Method ${request.method} is not allowed here.` },
			}),
			{
				status: 405,
				headers: { Allow: match.allow.join(', '), 'Content-Type': 'application/json; charset=utf-8' },
			},
		)
	}

	try {
		const authenticate = (await import('../auth/authenticate.ts')).authenticateBearer
		const auth = await authenticate(request, env)
		if (!auth) {
			return new Response(
				JSON.stringify({
					error: {
						code: 'unauthorized',
						message: 'Authentication required. Send Authorization: Bearer <Kody API token>.',
					},
				}),
				{
					status: 401,
					headers: {
						'Content-Type': 'application/json; charset=utf-8',
						'WWW-Authenticate': 'Bearer',
						'Cache-Control': 'no-store',
					},
				},
			)
		}
		const operationId = match.route.operation[2]
		let params = await readParams(request, url, operationId, request.method, registeredCapabilities)
		if (operationId === 'search') delete params.memoryContext
		params = mergeApiParams(renamedPathParams(match.route.pathParams, operationId), params)
		const capContext: CapabilityContext = context(env, execution, auth)
		if (operationId === 'search') {
			const runSearch = (await import('../mcp/search.ts')).search
			return Response.json(await runSearch(params as SearchInput, capContext), {
				headers: { 'Cache-Control': 'no-store' },
			})
		}
		if (operationId === 'execute') {
			if (params.credentials !== undefined) {
				throw error('invalid_input', 'The credentials field is not supported by celld.', 400)
			}
			validateExecuteApiInput(params)
			const runExecute = (await import('../mcp/server.ts')).runExecuteTool
			return Response.json(await runExecute(params, capContext), { headers: { 'Cache-Control': 'no-store' } })
		}
		const runCapability = (await import('../capabilities/registry.ts')).runCapability
		return Response.json(await runCapability(operationId, params, capContext), {
			headers: { 'Cache-Control': 'no-store' },
		})
	} catch (caught) {
		return errorResponse(caught, url.pathname)
	}
}
