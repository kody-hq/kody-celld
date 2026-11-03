const encoder = new TextEncoder()

/**
 * Replaces secret placeholders in a request body at the byte level.
 *
 * Every byte outside a placeholder span is copied unchanged, so binary parts
 * (a PNG inside multipart/form-data, for example) are never re-encoded. The
 * scan is a single forward pass: an inserted value is never scanned again, and
 * where two placeholders start at the same byte the longer one wins (so
 * `Basic {{secret-basic:...}}` beats the bare placeholder).
 *
 * Returns null when the body contains none of the placeholders.
 */
export function replaceBodyPlaceholders(
	body: ArrayBuffer,
	replacements: ReadonlyMap<string, string>,
): Uint8Array<ArrayBuffer> | null {
	const keys = [...replacements]
		.filter(([placeholder]) => placeholder.length > 0)
		.map(([placeholder, value]) => ({ bytes: encoder.encode(placeholder), value: encoder.encode(value) }))
		.sort((a, b) => b.bytes.length - a.bytes.length)
	if (keys.length === 0) return null
	const firstBytes = new Set(keys.map((key) => key.bytes[0]))
	const source = new Uint8Array(body)
	const chunks: Array<Uint8Array> = []
	let copiedUpTo = 0
	let total = 0
	let index = 0
	while (index < source.length) {
		const match = firstBytes.has(source[index]) ? keys.find((key) => startsWith(source, index, key.bytes)) : undefined
		if (!match) {
			index++
			continue
		}
		if (index > copiedUpTo) chunks.push(source.subarray(copiedUpTo, index))
		chunks.push(match.value)
		total += index - copiedUpTo + match.value.length
		index += match.bytes.length
		copiedUpTo = index
	}
	if (chunks.length === 0) return null
	if (copiedUpTo < source.length) {
		chunks.push(source.subarray(copiedUpTo))
		total += source.length - copiedUpTo
	}
	const out = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.length
	}
	return out
}

function startsWith(source: Uint8Array, at: number, prefix: Uint8Array) {
	if (at + prefix.length > source.length) return false
	for (let i = 0; i < prefix.length; i++) {
		if (source[at + i] !== prefix[i]) return false
	}
	return true
}
