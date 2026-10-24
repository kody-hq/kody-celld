import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listJsonSchemaSubsetProblems, listJsonSchemaSubsetValueErrors } from './json-schema-subset.ts'

describe('JSON Schema subset', () => {
	it('reports unsupported schema keywords', () => {
		const problems = listJsonSchemaSubsetProblems({
			type: 'object',
			pattern: 'ignored',
		})
		assert.match(problems[0] ?? '', /unsupported keyword "pattern"/)
	})

	it('compares JSON values canonically and reports value errors', () => {
		const schema = {
			type: 'object',
			properties: {
				settings: {
					type: 'object',
					const: { a: 1, b: 2 },
				},
			},
			required: ['settings'],
		}
		assert.deepEqual(listJsonSchemaSubsetProblems(schema), [])
		assert.deepEqual(listJsonSchemaSubsetValueErrors(schema, { settings: { b: 2, a: 1 } }), [])
		assert.deepEqual(listJsonSchemaSubsetValueErrors(schema, {}), ['payload is missing required property "settings".'])
	})
})
