import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderStartDocument } from './start-render.ts'
import type {
	AppLoaderData,
	PackageFilesLoaderData,
	PackagePreviewSummary,
	WorkflowView,
} from '#universal/loader-data.ts'

async function render(
	path: string,
	data: AppLoaderData,
	status = 200,
	signedIn = true,
) {
	const response = await renderStartDocument(
		new Request('http://localhost' + path),
		{
			title: 'Fixture',
			pathname: path,
			data,
			status,
			session: signedIn
				? {
						displayName: 'Fixture',
						email: 'fixture@example.invalid',
						avatarUrl: null,
						isAdmin: false,
					}
				: null,
			headers: { 'x-fixture': 'preserved', 'referrer-policy': 'no-referrer' },
		},
	)
	assert.equal(response.status, status)
	assert.equal(response.headers.get('x-fixture'), 'preserved')
	assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
	assert.equal(response.headers.get('cache-control'), 'no-store')
	assert.equal(response.headers.get('x-frame-options'), 'DENY')
	const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, '')
	assert.equal((html.match(/<!doctype html>/gi) ?? []).length, 1)
	assert.ok(!html.includes('/build/client-entry.js'))
	return html
}
const files: PackageFilesLoaderData = {
	ok: true,
	title: '@fixture/completion',
	backHref: '/account/packages/%40fixture%2Fcompletion',
	backLabel: 'Back to package',
	filesBasePath: '/account/packages/%40fixture%2Fcompletion/files',
	selectedPath: 'README.md',
	kind: 'file',
	paths: ['README.md', 'src/main.ts'],
	children: [],
	content: '# Fixture README',
	contentPath: 'README.md',
	contentKind: 'markdown',
	language: 'markdown',
}
const preview: PackagePreviewSummary = {
	source: 'https://github.com/fixture/completion',
	subdir: '',
	fetchedFrom: 'github',
	commit: null,
	name: '@fixture/completion',
	version: '1.0.0',
	description: 'Fixture preview',
	warnings: [],
	permissions: {
		jobs: [],
		webhooks: [],
		subscriptions: [],
		secretProvider: null,
		dependencies: [],
	},
}

describe('remaining Start document contracts', () => {
	for (const [path, data, heading] of [
		[
			'/account/integrations',
			{ page: 'accountIntegrations', csrf: 'fixture-csrf', integrations: [] },
			'Integrations',
		],
		[
			'/account/webhooks',
			{ page: 'accountWebhooks', webhooks: [] },
			'Webhooks',
		],
		[
			'/account/mcp-servers',
			{ page: 'accountMcpServers', csrf: 'fixture-csrf', servers: [] },
			'MCP servers',
		],
		[
			'/account/inbox',
			{
				page: 'accountEmail',
				domain: null,
				addresses: [],
				messages: [],
				selectedId: null,
				selected: null,
				bodyView: 'text',
			},
			'Email',
		],
		[
			'/account/jobs',
			{ page: 'accountJobs', csrf: 'fixture-csrf', jobs: [] },
			'Jobs',
		],
		[
			'/account/workflows',
			{ page: 'accountWorkflows', csrf: 'fixture-csrf', workflows: [] },
			'Workflows',
		],
		[
			'/account/packages',
			{
				page: 'accountPackages',
				csrf: 'fixture-csrf',
				packages: [],
				sourceHosts: ['github.com'],
				installError: null,
				installDraft: { source: '', subdir: '', as: '' },
				preview: null,
			},
			'Packages',
		],
	] satisfies Array<[string, AppLoaderData, string]>) {
		it('renders the empty ' + data.page + ' document', async () => {
			assert.match(
				await render(path, data),
				new RegExp('<h1[^>]*>' + heading + '</h1>'),
			)
		})
	}

	it('retains connected/pending/disconnected integrations and disconnects only connected rows', async () => {
		const html = await render('/account/integrations', {
			page: 'accountIntegrations',
			csrf: 'fixture-csrf',
			integrations: ['connected', 'pending', 'disconnected'].map((status) => ({
				name: 'fixture-' + status,
				provider: 'Fixture <provider>',
				status,
				expiresAt: null,
				allowedHosts: ['api.example.invalid'],
			})),
		})
		assert.ok(html.includes('Fixture &lt;provider&gt;'))
		assert.ok(html.includes('api.example.invalid'))
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
			.map(([s]) => s)
			.filter((s) => s.includes('action="/account/integrations"'))
		assert.equal(forms.length, 1)
		assert.match(forms[0]!, /name="name"[^>]*value="fixture-connected"/)
		assert.match(forms[0]!, /name="csrf"[^>]*value="fixture-csrf"/)
		assert.match(forms[0]!, /name="action"[^>]*value="disconnect"/)
	})

	it('renders minted/unminted webhook metadata without constructing a secret endpoint', async () => {
		const html = await render('/account/webhooks', {
			page: 'accountWebhooks',
			webhooks: [true, false].map((minted) => ({
				id: String(minted),
				packageName: '@fixture/completion',
				name: minted ? 'minted' : 'unminted',
				exportName: './hook.ts#main',
				description: '<fixture>',
				responseMode: 'sync',
				inputMode: 'params',
				verification: { type: 'hmac-sha256', header: 'x-fixture-signature' },
				minted,
				handle: minted ? 'wh_fixture' : null,
				enabled: minted ? false : null,
				deliveries: minted ? 3 : 0,
				lastDeliveryAt: minted ? '2026-01-01T00:00:00Z' : null,
				lastDeliveryStatus: minted ? 'error' : null,
				lastDeliveryHttpStatus: minted ? 500 : null,
			})),
		})
		for (const text of [
			'minted',
			'unminted',
			'wh_fixture',
			'x-fixture-signature',
			'HTTP 500',
		])
			assert.ok(html.includes(text), text)
		assert.match(html, /href="\/account\/packages\/%40fixture%2Fcompletion"/)
		assert.doesNotMatch(html, /href="[^"]*\/hooks\//)
	})

	it('renders MCP metadata and native management forms without credential prefill', async () => {
		const html = await render('/account/mcp-servers', {
			page: 'accountMcpServers',
			csrf: 'fixture-csrf',
			servers: [
				{
					name: 'Fixture <server>',
					host: 'mcp.example.invalid',
					status: 'authenticating',
					lastError: null,
					enabled: false,
					authKind: 'oauth',
					authorizeHref: '/account/mcp-servers/fixture/authorize',
					hasRefreshToken: true,
					oauthClient: {
						clientId: 'fixture-public-client',
						hasSecret: true,
						mode: 'preregistered',
					},
					usage: { mode: 'packages', packages: ['@fixture/completion'] },
					tools: [{ name: 'fixture_tool', description: '<tool>' }],
				},
			],
		})
		for (const text of [
			'Fixture &lt;server&gt;',
			'fixture_tool',
			'fixture-public-client',
		])
			assert.ok(html.includes(text), text)
		for (const [input] of html.matchAll(/<input\b[^>]*type="password"[^>]*>/g))
			assert.doesNotMatch(input, /\bvalue=/)
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
			.map(([s]) => s)
			.filter((s) => s.includes('action="/account/mcp-servers"'))
		assert.ok(forms.length >= 2)
		for (const form of forms) {
			assert.match(form, /method="post"/)
			assert.match(form, /name="csrf"[^>]*value="fixture-csrf"/)
		}
	})

	for (const canContinue of [true, false]) {
		it(
			'retains Worker-directed MCP authorization, canContinue=' + canContinue,
			async () => {
				const html = await render(
					'/account/mcp-servers/fixture%20server/authorize',
					{
						page: 'accountMcpServerAuthorize',
						csrf: 'fixture-csrf',
						name: 'fixture server',
						url: 'https://mcp.example.invalid',
						authorizationServerHost: 'auth.example.invalid',
						clientMode: 'preregistered',
						scopes: ['read'],
						canContinue,
						message: canContinue ? null : 'Fixture blocked',
					},
				)
				const form =
					/<form\b[^>]*action="\/account\/mcp-servers\/fixture%20server\/authorize"[^>]*>[\s\S]*?<\/form>/.exec(
						html,
					)?.[0]
				assert.equal(Boolean(form), canContinue)
				if (form) {
					assert.match(form, /method="post"/)
					assert.match(form, /name="csrf"[^>]*value="fixture-csrf"/)
				}
			},
		)
	}

	for (const bodyView of ['html', 'text', 'source'] as const) {
		it(
			'retains safe email ' + bodyView + ' body and attachment metadata',
			async () => {
				const html = await render(
					'/account/inbox/fixture-message?view=' + bodyView,
					{
						page: 'accountEmail',
						domain: 'example.invalid',
						addresses: ['fixture@example.invalid'],
						messages: [],
						selectedId: 'fixture-message',
						bodyView,
						selected: {
							id: 'fixture-message',
							direction: 'inbound',
							subject: 'Fixture <subject>',
							from: 'sender@example.invalid',
							to: ['fixture@example.invalid'],
							cc: [],
							replyTo: [],
							receivedAt: '2026-01-01T00:00:00Z',
							inboxAddress: 'fixture@example.invalid',
							classification: 'inbox',
							classificationReason: null,
							deliveryStatus: null,
							sizeBytes: 128,
							text: '<img onerror="fixture()">',
							html: '<p>Fixture HTML</p><script>fixture()</script>',
							attachments: [
								{
									id: 'fixture-attachment',
									filename: '<notes>.txt',
									contentType: 'text/plain',
									size: 12,
								},
							],
						},
					},
				)
				assert.ok(html.includes('Fixture &lt;subject&gt;'))
				assert.ok(html.includes('&lt;notes&gt;.txt'))
				const frame = /<iframe\b[^>]*>/.exec(html)?.[0]
				if (bodyView === 'html') {
					assert.ok(frame)
					assert.match(
						frame,
						/sandbox="allow-popups allow-popups-to-escape-sandbox"/,
					)
					assert.match(frame, /referrerPolicy="no-referrer"/i)
					assert.match(frame, /srcDoc="/i)
					assert.doesNotMatch(frame, /fixture\(\)/)
				} else assert.equal(frame, undefined)
				assert.doesNotMatch(html, /<img\b[^>]*onerror=/)
			},
		)
	}

	for (const status of [
		'queued',
		'running',
		'complete',
		'errored',
		'cancelled',
	] satisfies Array<WorkflowView['status']>) {
		it(
			'preserves ' + status + ' workflows and cancels only active runs',
			async () => {
				const html = await render('/account/workflows', {
					page: 'accountWorkflows',
					csrf: 'fixture-csrf',
					workflows: [
						{
							id: 'fixture-workflow',
							sourceType: 'package',
							packageId: '@fixture/completion',
							workflowName: 'Fixture workflow',
							exportName: './main.ts',
							idempotencyKey: 'fixture-key',
							status,
							attempts: 2,
							runAt: '2026-01-01T00:00:00Z',
							updatedAt: '2026-01-02T00:00:00Z',
							lastError: status === 'errored' ? '<failure>' : null,
						},
					],
				})
				assert.ok(html.includes('attempt 2'))
				const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
					.map(([s]) => s)
					.filter((s) => s.includes('action="/account/workflows"'))
				assert.equal(
					forms.length,
					status === 'queued' || status === 'running' ? 1 : 0,
				)
				if (forms[0])
					assert.match(forms[0], /name="csrf"[^>]*value="fixture-csrf"/)
				if (status === 'errored') assert.ok(html.includes('&lt;failure&gt;'))
			},
		)
	}

	for (const status of [400, 404, 500])
		for (const path of ['/fixture/missing', '/account/jobs', '/']) {
			it(
				'preserves error ' + status + ' at ' + path + ', with escaped details',
				async () => {
					const html = await render(
						path,
						{
							page: 'error',
							error: 'fixture_error',
							message: '<fixture failure>',
							status,
						},
						status,
					)
					assert.ok(html.includes('fixture_error'))
					assert.ok(html.includes('&lt;fixture failure&gt;'))
					assert.match(html, /href="\/account"[^>]*>Back to your account<\/a>/)
					assert.equal(
						/<img\b[^>]*src="\/images\/kody-/.test(html),
						status !== 400,
					)
				},
			)
		}
	it('retains signed-out error navigation', async () => {
		const html = await render(
			'/fixture/missing',
			{
				page: 'error',
				error: 'not_found',
				message: 'Fixture missing',
				status: 404,
			},
			404,
			false,
		)
		assert.match(html, /href="\/"[^>]*>Go home<\/a>/)
	})

	it('renders safe Markdown, accessible selected files and native file links without remote resources', async () => {
		const fence = String.fromCharCode(96).repeat(3)
		const content =
			'# Fixture README\n\n<script>fixture()</script>\n\n![remote](https://images.example.invalid/track.png)\n\n[allowed](https://docs.example.invalid/guide) [blocked](https://example.invalid/@fixture/packages/code)\n\n' +
			fence +
			'html\n<iframe src="https://example.invalid"></iframe>\n' +
			fence
		const html = await render(
			'/account/packages/%40fixture%2Fcompletion/files/README.md',
			{ page: 'accountPackageFiles', files: { ...files, content } },
		)
		assert.match(html, /aria-current="page"/)
		assert.match(
			html,
			/href="\/account\/packages\/%40fixture%2Fcompletion\/files\/README.md"/,
		)
		assert.ok(html.includes('&lt;script&gt;fixture()&lt;/script&gt;'))
		assert.doesNotMatch(
			html,
			/<img\b[^>]*src="https:\/\/images.example.invalid/,
		)
		assert.doesNotMatch(html, /<iframe\b/)
		assert.match(html, /href="https:\/\/docs.example.invalid\/guide"/)
		assert.doesNotMatch(
			html,
			/<a\b[^>]*href="https:\/\/example.invalid\/@fixture/,
		)
		assert.match(html, /class="shiki shiki-themes github-light github-dark"/)
	})

	it('preserves serialized syntax tokens and dual-theme inline styles as escaped JSX', async () => {
		const content = '<fixture>&'
		const html = await render(
			'/account/packages/%40fixture%2Fcompletion/files/src/main.ts',
			{
				page: 'accountPackageFiles',
				files: {
					...files,
					selectedPath: 'src/main.ts',
					contentPath: 'src/main.ts',
					contentKind: 'code',
					language: 'ts',
					content,
					contentHighlighted: {
						code: content,
						lang: 'ts',
						plain: false,
						fg: '#111;--shiki-dark:#eee',
						bg: '#fff;--shiki-dark-bg:#222',
						lines: [
							[{ content, style: { color: '#123', '--shiki-dark': '#abc' } }],
						],
					},
				},
			},
		)
		assert.match(html, /class="shiki shiki-themes github-light github-dark"/)
		assert.ok(html.includes('--shiki-dark:#abc'))
		assert.ok(html.includes('&lt;fixture&gt;&amp;'))
		assert.doesNotMatch(html, /<fixture>/)
	})

	it('renders package detail operations and preview install as native CSRF forms', async () => {
		const html = await render('/account/packages/%40fixture%2Fcompletion', {
			page: 'accountPackageDetail',
			csrf: 'fixture-csrf',
			error: null,
			files,
			pkg: {
				name: '@fixture/completion',
				version: '1.0.0',
				description: 'Fixture package',
				source: 'https://github.com/fixture/completion',
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-01-01T00:00:00Z',
				hidden: false,
				published: { version: '1.0.0' },
				appOpenHref: null,
				exports: [{ specifier: '.', path: './main.ts' }],
				jobs: [],
				webhooks: [],
				fileCount: 2,
			},
		})
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
			.map(([s]) => s)
			.filter((s) => s.includes('action="/account/packages'))
		assert.ok(forms.length >= 3)
		for (const form of forms) {
			assert.match(form, /method="post"/)
			assert.match(form, /name="csrf"[^>]*value="fixture-csrf"/)
		}
		const previewHtml = await render(
			'/account/packages/preview/files/README.md',
			{
				page: 'accountPackagePreviewFiles',
				csrf: 'fixture-csrf',
				preview,
				files: { ...files, filesBasePath: '/account/packages/preview/files' },
			},
		)
		assert.match(previewHtml, /name="csrf"[^>]*value="fixture-csrf"/)
		assert.match(previewHtml, /name="action"[^>]*value="install"/)
	})
})
