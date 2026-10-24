export function canonicalizeJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => canonicalizeJsonValue(entry))
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, canonicalizeJsonValue(record[key])]),
		)
	}
	return value
}

export function canonicalJsonStringify(value: unknown): string {
	return JSON.stringify(canonicalizeJsonValue(value)) as string
}
