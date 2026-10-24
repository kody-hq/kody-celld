import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalJsonStringify } from './canonical-json.ts'

describe('canonicalJsonStringify', () => {
	it('sorts object keys recursively and preserves array order', () => {
		assert.equal(
			canonicalJsonStringify({ b: 1, a: { d: [2, { z: 3, y: 4 }], c: 5 } }),
			'{"a":{"c":5,"d":[2,{"y":4,"z":3}]},"b":1}',
		)
		assert.equal(canonicalJsonStringify([3, 1, 2]), '[3,1,2]')
	})
})
