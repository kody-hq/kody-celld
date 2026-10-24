import { KodyError } from '../lib/errors.ts'

type JsonSchema = Record<string, unknown>

export const maxApiRequestBodyBytes = 5 * 1024 * 1024
export const apiAuthReservedQueryKeys = new Set(['org'])

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schemaTypes(schema: JsonSchema | undefined): Set<string> {
	const types = new Set<string>()
	if (!schema) return types
	const type = schema.type
	if (typeof type === 'string') types.add(type)
	if (Array.isArray(type)) {
		for (const entry of type) if (typeof entry === 'string') types.add(entry)
	}
	for (const key of ['anyOf', 'oneOf'] as const) {
		const variants = schema[key]
		if (!Array.isArray(variants)) continue
		for (const variant of variants) {
			if (isRecord(variant)) {
				for (const entry of schemaTypes(variant)) types.add(entry)
			}
		}
	}
	return types
}

function coerceScalar(value: string, schema: JsonSchema | undefined): unknown {
	const types = schemaTypes(schema)
	if (types.has('string') || types.size === 0) return value
	if (types.has('boolean') && (value === 'true' || value === 'false')) return value === 'true'
	if ((types.has('integer') || types.has('number')) && value.trim() !== '' && Number.isFinite(Number(value))) {
		return Number(value)
	}
	if (types.has('null') && value === 'null') return null
	return value
}

export function readQueryParams(searchParams: URLSearchParams, inputSchema: JsonSchema) {
	const properties = isRecord(inputSchema.properties) ? (inputSchema.properties as Record<string, JsonSchema>) : {}
	const params: Record<string, unknown> = {}
	for (const name of new Set(searchParams.keys())) {
		if (apiAuthReservedQueryKeys.has(name)) continue
		const schema = properties[name]
		const values = searchParams.getAll(name)
		if (schemaTypes(schema).has('array')) {
			const items = isRecord(schema?.items) ? (schema.items as JsonSchema) : undefined
			params[name] = values.map((value) => coerceScalar(value, items))
			continue
		}
		if (values.length > 1) {
			throw new KodyError('invalid_request', `Query parameter "${name}" must appear once.`)
		}
		params[name] = coerceScalar(values[0]!, schema)
	}
	return params
}

export async function readJsonBody(request: Request) {
	const declaredLength = Number(request.headers.get('Content-Length') ?? '0')
	if (declaredLength > maxApiRequestBodyBytes) return { kind: 'too_large' as const, byteLength: declaredLength }
	const reader = request.body?.getReader()
	if (!reader) return { kind: 'ok' as const, body: {} }
	const chunks: Uint8Array[] = []
	let byteLength = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			byteLength += value.byteLength
			if (byteLength > maxApiRequestBodyBytes) {
				void reader.cancel().catch(() => undefined)
				return { kind: 'too_large' as const, byteLength }
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}
	const bytes = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	const text = new TextDecoder().decode(bytes)
	if (!text.trim()) return { kind: 'ok' as const, body: {} }
	const contentType = request.headers.get('Content-Type') ?? ''
	if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType.trim())) {
		return { kind: 'unsupported_media_type' as const }
	}
	let body: unknown
	try {
		body = JSON.parse(text) as unknown
	} catch {
		throw new KodyError('invalid_request', 'Request body must be valid JSON.')
	}
	if (!isRecord(body)) throw new KodyError('invalid_request', 'Request body must be a JSON object.')
	return { kind: 'ok' as const, body }
}

export function mergeApiParams(pathParams: Record<string, string>, params: Record<string, unknown>) {
	for (const [name, value] of Object.entries(pathParams)) {
		if (name in params && params[name] !== value) {
			throw new KodyError(
				'invalid_request',
				`"${name}" is set by the URL path and must not differ in the query or body.`,
			)
		}
	}
	return { ...params, ...pathParams }
}
