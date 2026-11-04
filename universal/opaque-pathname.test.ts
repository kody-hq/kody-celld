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
	['/community/%e2%9c%93', '/community/%E2%9C%93'],
	['/community/%61', '/community/a'],
	['/community/fixture+name', '/community/fixture%2Bname'],
	['/community/%25literal', '/community/%25literal'],
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
	it(
		'canonicalizes encoded segments without interpreting malformed bytes: ' +
			pathname,
		() => {
			assert.equal(opaquePathname(pathname), expected)
			assert.equal(opaquePathname(expected), expected)
		},
	)
}
