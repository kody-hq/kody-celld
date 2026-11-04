import assert from 'node:assert/strict'
import { it } from 'node:test'
import { opaquePathname } from './opaque-pathname.ts'

for (const [pathname, expected] of [
	['/account/jobs', '/account/jobs'],
	[
		'/account/packages/%40fixture%2Fexample/files/a%25b.ts',
		'/account/packages/%40fixture%2Fexample/files/a%25b.ts',
	],
	['/community/%E2%9C%93', '/community/%E2%9C%93'],
	[
		'/account/mcp-servers/%E0%A4%A/authorize',
		'/account/mcp-servers/%25E0%25A4%25A/authorize',
	],
	['/account/mcp-servers/%/authorize', '/account/mcp-servers/%25/authorize'],
	[
		'/account/packages/%40fixture%2Fexample/files/%80/a%25b.ts',
		'/account/packages/%40fixture%2Fexample/files/%2580/a%25b.ts',
	],
] as const) {
	it('keeps URI bytes opaque only in malformed segments: ' + pathname, () => {
		assert.equal(opaquePathname(pathname), expected)
	})
}
