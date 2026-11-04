import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { renderStartDocument } from './start-render.ts'
import {
	contentSecurityPolicyWithFormAction,
	firstPartySecurityHeaders,
} from './security-headers.ts'
import { getDocumentTimestampLocale } from '../../start/document-locale.ts'
import type { AppLoaderData } from '#universal/loader-data.ts'
import { defaultQuotas } from '../lib/limits.ts'

function render(pathname = '/brand-guide', displayName?: string) {
	return renderStartDocument(new Request(`http://localhost${pathname}`), {
		title: 'Brand guide',
		pathname: '/brand-guide',
		data: { page: 'brandGuide' },
		session: displayName
			? {
					displayName,
					email: 'fixture@example.invalid',
					avatarUrl: null,
					isAdmin: true,
				}
			: null,
		headers: { 'referrer-policy': 'no-referrer' },
	})
}

describe('Start document renderer', () => {
	it('renders the open-error list with encoded detail links and native triage forms', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/runs?view=errors'),
			{
				title: 'Runs',
				pathname: '/account/runs',
				data: {
					page: 'accountActivity',
					csrf: 'fixture-csrf',
					view: 'errors',
					error: null,
					summary: { errors: 3, ignored: 1, resolved: 2, running: 1 },
					runs: ['run & cue', 'next/error'].map((id) => ({
						id,
						createdAt: '2026-01-01T00:00:00Z',
						kind: 'execute',
						packageName: null,
						status: 'error',
						durationMs: 15,
						error: 'Fixture <failure> & trace',
						errorTriage: null,
					})),
					selectedId: null,
					selected: null,
				},
			},
		)
		assert.equal(response.status, 200)
		const html = await response.text()
		assert.ok(html.includes('3 open errors'))
		assert.ok(
			html
				.replace(/<!--[\s\S]*?-->/g, '')
				.includes('3 open errors · 1 ignored · 2 resolved · 1 running'),
		)
		assert.ok(html.includes('2 of 3'))
		assert.ok(html.includes('Fixture &lt;failure&gt; &amp; trace'))
		assert.ok(html.includes('href="/account/runs/run%20%26%20cue?view=errors"'))
		assert.ok(html.includes('href="/account/runs/next%2Ferror?view=errors"'))
		assert.ok(html.includes('href="/account/runs?view=recent"'))
		assert.match(html, /aria-current="page"[^>]*>Open errors/)
		assert.ok(html.includes('Look at my open Kody activity errors.'))
		assert.ok(html.includes('Copy prompt'))
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
			([form]) => form,
		)
		assert.equal(forms.length, 4)
		for (const form of forms) {
			assert.match(form, /method="post"/)
			assert.match(form, /action="\/account\/runs"/)
			assert.match(form, /name="csrf"[^>]*value="fixture-csrf"/)
			assert.match(form, /name="action"[^>]*value="triage"/)
			assert.match(form, /name="view"[^>]*value="errors"/)
			assert.match(
				form,
				/name="runId"[^>]*value="(?:run &amp; cue|next\/error)"/,
			)
			assert.match(form, /name="triage"[^>]*value="(?:ignored|resolved)"/)
			assert.doesNotMatch(form, /name="open"/)
		}
		assert.ok(!html.includes('data-testid="run-detail"'))
	})

	it('renders recent runs with native reopen forms and escaped triage errors', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/runs?view=recent'),
			{
				title: 'Runs',
				pathname: '/account/runs',
				status: 400,
				data: {
					page: 'accountActivity',
					csrf: 'fixture-csrf',
					view: 'recent',
					error: 'Triage <denied>',
					summary: { errors: 0, ignored: 1, resolved: 1, running: 1 },
					runs: [
						...(['ignored', 'resolved'] as const).map((errorTriage) => ({
							id: errorTriage,
							createdAt: '2026-01-01T00:00:00Z',
							kind: 'package',
							packageName: '@fixture/activity',
							status: 'error',
							durationMs: 15,
							error: 'Fixture failure',
							errorTriage,
						})),
						...['success', 'running'].map((status) => ({
							id: status,
							createdAt: '2026-01-01T00:00:00Z',
							kind: 'execute',
							packageName: null,
							status,
							durationMs: null,
							error: null,
							errorTriage: null,
						})),
					],
					selectedId: null,
					selected: null,
				},
			},
		)
		assert.equal(response.status, 400)
		const html = await response.text()
		assert.match(html, /role="alert"[^>]*aria-live="assertive"/)
		assert.ok(html.includes('Triage &lt;denied&gt;'))
		assert.match(html, /aria-current="page"[^>]*>Recent runs/)
		assert.ok(html.includes('href="/account/runs?view=errors"'))
		assert.ok(html.includes('href="/account/runs/success?view=recent"'))
		assert.ok(!html.includes('Copy prompt'))
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
			([form]) => form,
		)
		assert.equal(forms.length, 2)
		for (const form of forms) {
			assert.match(form, /method="post"/)
			assert.match(form, /action="\/account\/runs"/)
			assert.match(form, /name="csrf"[^>]*value="fixture-csrf"/)
			assert.match(form, /name="action"[^>]*value="triage"/)
			assert.match(form, /name="view"[^>]*value="recent"/)
			assert.match(form, /name="triage"[^>]*value="open"/)
			assert.match(form, /name="runId"[^>]*value="(?:ignored|resolved)"/)
			assert.doesNotMatch(form, /name="open"/)
		}
	})

	it('renders the empty recent Activity list without mutation forms', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/runs'),
			{
				title: 'Runs',
				pathname: '/account/runs',
				data: {
					page: 'accountActivity',
					csrf: 'fixture-csrf',
					view: 'recent',
					error: null,
					summary: { errors: 0, ignored: 0, resolved: 0, running: 0 },
					runs: [],
					selectedId: null,
					selected: null,
				},
			},
		)
		assert.equal(response.status, 200)
		const html = await response.text()
		assert.ok(html.includes('No runs yet.'))
		assert.ok(html.includes('0 open errors'))
		assert.ok(!html.includes('<form'))
		assert.ok(!html.includes('Copy prompt'))
	})

	it('renders memory detail, encoded query links and native filter/delete forms', async () => {
		const id = 'mem & cue'
		const memory = {
			id,
			subject: 'Atlas <safe>',
			category: 'notes',
			status: 'active' as const,
			tags: ['tag <one>'],
			summary: 'Summary & detail',
			updatedAt: '2026-01-01T00:00:00Z',
		}
		const response = await renderStartDocument(
			new Request(
				'http://localhost/account/memories/mem%20%26%20cue?q=Atlas&includeDeleted=1',
			),
			{
				title: 'Memories',
				pathname: '/account/memories/mem%20%26%20cue',
				data: {
					page: 'accountMemories',
					csrf: 'fixture-csrf',
					query: 'Atlas & cue',
					includeDeleted: true,
					total: 1,
					memories: [memory],
					selectedId: id,
					selected: {
						...memory,
						details: 'Line <one>\nLine & two',
						sourceUris: [
							'https://example.invalid/source?x=1&y=2',
							'file:///fixture',
							'javascript:alert(1)',
						],
						dedupeKey: null,
						createdAt: '2026-01-01T00:00:00Z',
						lastAccessedAt: null,
						deletedAt: null,
					},
				},
			},
		)
		assert.equal(response.status, 200)
		const html = await response.text()
		assert.ok(html.includes('Atlas &lt;safe&gt;'))
		assert.ok(html.includes('Line &lt;one&gt;\nLine &amp; two'))
		assert.ok(html.includes('name="q"'))
		assert.ok(html.includes('value="Atlas &amp; cue"'))
		assert.match(html, /name="includeDeleted"[^>]*checked=""/)
		assert.ok(
			html.includes(
				'/account/memories/mem%20%26%20cue?q=Atlas+%26+cue&amp;includeDeleted=1',
			),
		)
		assert.match(
			html,
			/<a\b[^>]*href="https:\/\/example\.invalid\/source\?x=1&amp;y=2"[^>]*target="_blank"[^>]*rel="noreferrer"/,
		)
		assert.ok(html.includes('file:///fixture'))
		assert.doesNotMatch(html, /<a\b[^>]*href="(?:javascript:|file:)/i)
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
			([form]) => form,
		)
		assert.equal(forms.length, 3)
		const [searchForm, softForm, hardForm] = forms
		assert.ok(searchForm && softForm && hardForm)
		assert.match(searchForm, /method="get"/)
		assert.match(searchForm, /action="\/account\/memories"/)
		for (const form of [softForm, hardForm]) {
			assert.match(form, /method="post"/)
			assert.match(form, /action="\/account\/memories"/)
			for (const [name, value] of Object.entries({
				csrf: 'fixture-csrf',
				action: 'delete',
				memoryId: 'mem &amp; cue',
			}))
				assert.match(form, new RegExp(`name="${name}"[^>]*value="${value}"`))
		}
		assert.doesNotMatch(softForm, /name="force"/)
		assert.match(hardForm, /name="force"[^>]*value="true"/)
	})

	it('renders a missing memory as a 404 without deletion actions', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/memories/missing'),
			{
				title: 'Memories',
				pathname: '/account/memories/missing',
				status: 404,
				data: {
					page: 'accountMemories',
					csrf: 'fixture-csrf',
					query: '',
					includeDeleted: false,
					total: 0,
					memories: [],
					selectedId: 'missing',
					selected: null,
				},
			},
		)
		assert.equal(response.status, 404)
		const html = await response.text()
		assert.ok(html.includes('Memory not found'))
		assert.ok(html.includes('No memories yet'))
		assert.ok(!html.includes('name="memoryId"'))
	})

	it('does not offer soft deletion of an already-deleted memory', async () => {
		const memory = {
			id: 'deleted',
			subject: 'Archived fixture',
			category: null,
			status: 'deleted' as const,
			tags: [],
			summary: 'Removed',
			updatedAt: '2026-01-01T00:00:00Z',
		}
		const response = await renderStartDocument(
			new Request('http://localhost/account/memories/deleted?includeDeleted=1'),
			{
				title: 'Memories',
				pathname: '/account/memories/deleted',
				data: {
					page: 'accountMemories',
					csrf: 'fixture-csrf',
					query: '',
					includeDeleted: true,
					total: 1,
					memories: [memory],
					selectedId: memory.id,
					selected: {
						...memory,
						details: '',
						sourceUris: [],
						dedupeKey: null,
						createdAt: '2026-01-01T00:00:00Z',
						lastAccessedAt: null,
						deletedAt: '2026-01-02T00:00:00Z',
					},
				},
			},
		)
		assert.equal(response.status, 200)
		const html = await response.text()
		assert.ok(html.includes('Delete permanently'))
		assert.ok(!html.includes('Soft delete'))
		assert.match(html, /name="force"[^>]*value="true"/)
	})

	it('renders secret metadata, scope-specific native mutations and a blank save form', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/secrets'),
			{
				title: 'Secrets',
				pathname: '/account/secrets',
				data: {
					page: 'accountSecrets',
					csrf: 'fixture-csrf',
					secrets: [
						{
							name: 'OPEN',
							scope: 'user',
							packageName: null,
							description: null,
							allowedPackages: [],
						},
						{
							name: 'ONE',
							scope: 'user',
							packageName: null,
							description: 'Fixture <&>',
							allowedPackages: ['@fixture/one'],
						},
						{
							name: 'MANY',
							scope: 'user',
							packageName: null,
							description: null,
							allowedPackages: ['@fixture/one', '@fixture/two'],
						},
						{
							name: 'SCOPED',
							scope: 'package',
							packageName: '@fixture/one',
							description: null,
							allowedPackages: [],
						},
					].map((secret) => ({
						...secret,
						scope: secret.scope as 'user' | 'package',
						updatedAt: '2026-01-01T00:00:00.000Z',
					})),
					hosts: [
						{
							host: 'fixture.example.invalid',
							approvedAt: '2026-01-02T00:00:00.000Z',
							approvedBy: 'Fixture <&>',
						},
					],
				},
			},
		)
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('cache-control'), 'no-store')
		const html = await response.text()
		assert.ok(!html.includes('/build/client-entry.js'))
		assert.ok(html.includes('<script src="/one-time-document.js"></script>'))
		assert.ok(
			html.indexOf('src="/one-time-document.js"') < html.indexOf('<body>'),
		)
		assert.ok(html.includes('Account sections'))
		assert.ok(html.includes('4 total'))
		assert.ok(html.includes('Any package'))
		assert.match(html, /Only (?:<!-- -->)?@fixture\/one/)
		assert.ok(html.includes('Fixture &lt;&amp;&gt;'))
		assert.ok(html.includes('fixture.example.invalid'))
		assert.ok(html.includes('Approvals are made by the operator'))
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
			([form]) => form,
		)
		assert.equal(forms.length, 8)
		const fields = (form: string) =>
			Object.fromEntries(
				[...form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)].map(
					([input]) => [
						input.match(/\bname="([^"]*)"/)?.[1],
						input.match(/\bvalue="([^"]*)"/)?.[1],
					],
				),
			)
		for (const form of forms) {
			assert.ok(form.includes('method="post"'))
			assert.ok(form.includes('action="/account/secrets"'))
			assert.equal(fields(form).csrf, 'fixture-csrf')
		}
		const deletions = forms
			.filter((form) => fields(form).action === 'delete')
			.map(fields)
		assert.deepEqual(
			deletions.map(({ name, packageName }) => ({ name, packageName })),
			[
				{ name: 'OPEN', packageName: '' },
				{ name: 'ONE', packageName: '' },
				{ name: 'MANY', packageName: '' },
				{ name: 'SCOPED', packageName: '@fixture/one' },
			],
		)
		const grants = forms
			.filter((form) => fields(form).action === 'remove_grant')
			.map(fields)
		assert.deepEqual(
			grants.map(({ name, packageName }) => ({ name, packageName })),
			[
				{ name: 'ONE', packageName: '@fixture/one' },
				{ name: 'MANY', packageName: '@fixture/one' },
				{ name: 'MANY', packageName: '@fixture/two' },
			],
		)
		const save = forms.find((form) => fields(form).action === 'save')
		assert.ok(save)
		assert.match(save, /autocomplete="off"/i)
		assert.match(save, /<input\b[^>]*name="name"[^>]*required\b/)
		assert.ok(save.includes('pattern="[a-zA-Z0-9._\\-]+"'))
		assert.match(
			save,
			/<textarea\b[^>]*name="value"[^>]*data-sensitive-value=""[^>]*required\b[^>]*><\/textarea>/,
		)
		assert.ok(save.includes('name="description"'))
		assert.ok(save.includes('Save secret'))
	})

	it('renders empty secrets and approved hosts while retaining the native save form', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/secrets'),
			{
				title: 'Secrets',
				pathname: '/account/secrets',
				data: {
					page: 'accountSecrets',
					csrf: 'fixture-csrf',
					secrets: [],
					hosts: [],
				},
			},
		)
		const html = await response.text()
		assert.ok(html.includes('No secrets yet.'))
		assert.ok(html.includes('No approved hosts.'))
		assert.ok(html.includes('<script src="/one-time-document.js"></script>'))
		assert.equal([...html.matchAll(/<form\b/g)].length, 1)
		assert.ok(!html.includes('value="delete"'))
		assert.ok(!html.includes('value="remove_grant"'))
		assert.ok(!html.includes('value="approve_host"'))
		assert.ok(html.includes('value="save"'))
	})

	for (const state of [
		{ label: 'unrestricted', allowedPackages: [], alreadyGranted: false },
		{
			label: 'restricted',
			allowedPackages: ['@fixture/one'],
			alreadyGranted: false,
		},
		{
			label: 'already-approved',
			allowedPackages: ['@fixture/one', '@fixture/two'],
			alreadyGranted: true,
		},
	]) {
		it(`renders ${state.label} owner-only package approval without a secret value`, async () => {
			const response = await renderStartDocument(
				new Request(
					'http://localhost/account/secrets/approve?name=FIXTURE&package=fixture',
				),
				{
					title: 'Approve package access',
					pathname: '/account/secrets/approve',
					data: {
						page: 'accountSecretApprove',
						csrf: 'fixture-csrf',
						name: 'Fixture <&>',
						packageName: '@fixture/two',
						allowedPackages: state.allowedPackages,
						alreadyGranted: state.alreadyGranted,
					},
				},
			)
			assert.equal(response.status, 200)
			assert.equal(response.headers.get('cache-control'), 'no-store')
			const html = await response.text()
			assert.ok(!html.includes('/build/client-entry.js'))
			assert.ok(!html.includes('src="/one-time-document.js"'))
			assert.ok(html.includes('Only the account owner can approve'))
			assert.ok(html.includes('Fixture &lt;&amp;&gt;'))
			assert.ok(!html.includes('name="value"'))
			assert.equal(
				html.includes('will limit package use to the approved list'),
				state.allowedPackages.length === 0,
			)
			assert.equal(
				html.includes('Currently approved packages:'),
				state.allowedPackages.length > 0,
			)
			assert.equal(
				html.includes('This package is already approved.'),
				state.alreadyGranted,
			)
			const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
				([form]) => form,
			)
			assert.equal(forms.length, state.alreadyGranted ? 0 : 1)
			if (!state.alreadyGranted) {
				const form = forms[0]!
				assert.ok(form.includes('method="post"'))
				assert.ok(form.includes('action="/account/secrets/approve"'))
				for (const value of [
					'fixture-csrf',
					'allow',
					'Fixture &lt;&amp;&gt;',
					'@fixture/two',
				])
					assert.ok(form.includes(`value="${value}"`))
				for (const name of ['csrf', 'action', 'name', 'packageName'])
					assert.ok(form.includes(`name="${name}"`))
				assert.ok(form.includes('Allow package'))
			}
		})
	}

	it('renders API-token metadata and native create/revoke forms without a credential receipt', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/tokens'),
			{
				title: 'API tokens',
				pathname: '/account/tokens',
				data: {
					page: 'accountApiTokens',
					csrf: 'fixture-csrf',
					publicUrl: 'https://fixture.example.invalid',
					issued: null,
					tokens: [null, '2026-01-02T00:00:00.000Z'].map((lastUsedAt, i) => ({
						id: `fixture-token-${i}`,
						label: `Fixture <&> ${i}`,
						createdAt: '2026-01-01T00:00:00.000Z',
						lastUsedAt,
					})),
				},
			},
		)
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('cache-control'), 'no-store')
		const html = await response.text()
		assert.ok(!html.includes('/build/client-entry.js'))
		assert.ok(html.includes('Fixture &lt;&amp;&gt; 0'))
		assert.ok(html.includes('never'))
		assert.ok(html.includes('Account sections'))
		assert.ok(!html.includes('Copy API token'))
		assert.ok(!html.includes('src="/one-time-document.js"'))
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
			([form]) => form,
		)
		assert.equal(forms.length, 3)
		for (const form of forms) {
			assert.ok(form.includes('method="post"'))
			assert.ok(form.includes('action="/account/tokens"'))
			assert.ok(form.includes('name="csrf"'))
			assert.ok(form.includes('value="fixture-csrf"'))
		}
		const create = forms.find((form) => form.includes('value="create"'))
		assert.ok(create)
		assert.ok(create.includes('name="label"'))
		assert.match(create, /maxlength="80"/i)
		for (const id of ['fixture-token-0', 'fixture-token-1']) {
			assert.ok(
				forms.some(
					(form) =>
						form.includes('value="revoke"') &&
						form.includes('name="tokenId"') &&
						form.includes(`value="${id}"`),
				),
			)
		}
	})

	it('renders a one-time API-token receipt only when supplied by the handler', async () => {
		const value = `${randomUUID()}<&>`
		for (const issued of [
			null,
			{ kind: 'token' as const, label: 'Fixture <&>', value, expiresAt: null },
		]) {
			const response = await renderStartDocument(
				new Request('http://localhost/account/tokens', {
					method: issued ? 'POST' : 'GET',
				}),
				{
					title: 'API tokens',
					pathname: '/account/tokens',
					data: {
						page: 'accountApiTokens',
						csrf: 'fixture-csrf',
						publicUrl: 'https://fixture.example.invalid',
						tokens: [],
						issued,
					},
				},
			)
			assert.equal(response.status, 200)
			assert.equal(response.headers.get('cache-control'), 'no-store')
			const html = await response.text()
			assert.ok(html.includes('No API tokens.'))
			assert.equal(html.includes('Copy API token'), issued !== null)
			assert.equal(html.includes('Copy it now'), issued !== null)
			const guard = html.indexOf('src="/one-time-document.js"')
			assert.equal(guard !== -1, issued !== null)
			if (issued) {
				assert.ok(guard < html.indexOf('<body>'))
				assert.ok(
					html.includes('<script src="/one-time-document.js"></script>'),
				)
			}
			assert.equal(
				html.includes(value.replace('<&>', '&lt;&amp;&gt;')),
				issued !== null,
			)
			assert.ok(!html.includes(value))
			if (issued) {
				assert.ok(html.includes('Fixture &lt;&amp;&gt;'))
				assert.ok(html.includes('Authorization: Bearer'))
				assert.ok(html.includes('https://fixture.example.invalid/mcp'))
			}
		}
	})

	it('renders connected MCP clients with native per-grant and revoke-all forms', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/clients'),
			{
				title: 'MCP clients',
				pathname: '/account/clients',
				data: {
					page: 'accountMcpOauthClients',
					csrf: 'fixture-csrf',
					publicUrl: 'https://fixture.example.invalid',
					grants: [null, '2026-01-02T00:00:00.000Z'].map((lastUsedAt, i) => ({
						id: `fixture-grant-${i}`,
						clientId: `fixture-client-${i}`,
						clientName: `Fixture <&> ${i}`,
						createdAt: '2026-01-01T00:00:00.000Z',
						lastUsedAt,
						activeFamilies: i + 1,
					})),
				},
			},
		)
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('cache-control'), 'no-store')
		const html = await response.text()
		assert.ok(!html.includes('/build/client-entry.js'))
		assert.ok(html.includes('Fixture &lt;&amp;&gt; 0'))
		assert.ok(html.includes('never'))
		assert.ok(html.includes('Active devices'))
		assert.ok(html.includes('Account sections'))
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
			([form]) => form,
		)
		assert.equal(forms.length, 3)
		for (const form of forms) {
			assert.ok(form.includes('method="post"'))
			assert.ok(form.includes('action="/account/clients"'))
			assert.ok(form.includes('name="csrf"'))
			assert.ok(form.includes('value="fixture-csrf"'))
		}
		for (const id of ['fixture-grant-0', 'fixture-grant-1']) {
			assert.ok(
				forms.some(
					(form) =>
						form.includes('value="revoke"') &&
						form.includes('name="grantId"') &&
						form.includes(`value="${id}"`),
				),
			)
		}
		assert.ok(
			forms.some(
				(form) =>
					form.includes('value="revoke_all"') &&
					form.includes('Revoke all clients'),
			),
		)
	})

	it('renders empty MCP clients without destructive forms', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/clients'),
			{
				title: 'MCP clients',
				pathname: '/account/clients',
				data: {
					page: 'accountMcpOauthClients',
					csrf: 'fixture-csrf',
					publicUrl: 'https://fixture.example.invalid',
					grants: [],
				},
			},
		)
		assert.equal(response.status, 200)
		const html = await response.text()
		assert.ok(html.includes('No connected clients yet.'))
		assert.ok(html.includes('https://fixture.example.invalid/mcp'))
		assert.ok(!html.includes('Revoke all clients'))
		assert.ok(!/<form\b/.test(html))
	})

	it('renders account identity, usage and password setup/change as native CSRF forms', async () => {
		for (const hasPassword of [false, true]) {
			const response = await renderStartDocument(
				new Request('http://localhost/account'),
				{
					title: 'Account',
					pathname: '/account',
					data: {
						page: 'account',
						csrf: 'fixture-csrf',
						email: 'fixture+<&>@example.invalid',
						createdAt: '2026-01-01T00:00:00.000Z',
						publicUrl: 'https://fixture.example.invalid',
						grantCount: 1,
						tokenCount: 2,
						hasPassword,
						usage: {
							today: { runs: 3, errors: 1, executeMs: 1500 },
							counts: {
								packages: 2,
								secrets: 1,
								jobs: 4,
								blobs: 1,
								blobBytes: 2048,
							},
							quotas: {
								runsPerDay: 10,
								executeMsPerDay: 60000,
								packages: 5,
								secrets: null,
							},
							limits: { executeTimeoutMs: 30000, runRetentionCount: 100 },
						},
						passwordForm: {
							action: '/account/password',
							submit: hasPassword ? 'Change password' : 'Set password',
							requireCurrent: hasPassword,
							minLength: 12,
						},
					},
				},
			)
			assert.equal(response.status, 200)
			assert.equal(response.headers.get('cache-control'), 'no-store')
			const html = await response.text()
			assert.ok(!html.includes('/build/client-entry.js'))
			assert.ok(html.includes('fixture+&lt;&amp;&gt;@example.invalid'))
			assert.ok(html.includes('https://fixture.example.invalid/mcp'))
			assert.ok(html.includes('1 connected client'))
			assert.ok(html.includes('2 API tokens'))
			assert.ok(html.includes('3 / 10'))
			assert.ok(html.includes('2 s / 60 s'))
			assert.ok(html.includes('Account sections'))
			assert.ok(!html.includes('Admin sections'))
			const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
				([form]) => form,
			)
			assert.equal(forms.length, 2)
			for (const form of forms) {
				assert.ok(form.includes('method="post"'))
				assert.ok(form.includes('name="csrf"'))
				assert.ok(form.includes('value="fixture-csrf"'))
			}
			assert.ok(forms.some((form) => form.includes('action="/signout"')))
			const password = forms.find((form) =>
				form.includes('action="/account/password"'),
			)
			assert.ok(password)
			assert.equal(password.includes('name="current"'), hasPassword)
			assert.ok(password.includes('minlength="12"'))
			const inputs = [
				...password.matchAll(/<input\b[^>]*\btype="password"[^>]*>/g),
			].map(([input]) => input)
			assert.equal(inputs.length, hasPassword ? 3 : 2)
			for (const input of inputs) {
				assert.ok(!/\svalue=/.test(input))
				assert.ok(input.includes('required'))
			}
		}
	})

	it('renders current and other browser sessions with escaped device names and native revoke forms', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/sessions'),
			{
				title: 'Browser sessions',
				pathname: '/account/sessions',
				data: {
					page: 'accountSessions',
					csrf: 'fixture-csrf',
					sessions: [true, false].map((current) => ({
						id: current ? 'fixture-current' : 'fixture-other',
						current,
						userAgent: current ? 'fixture browser <&>' : null,
						createdAt: '2026-01-01T00:00:00.000Z',
						lastSeenAt: null,
						expiresAt: '2026-02-01T00:00:00.000Z',
					})),
				},
			},
		)
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('cache-control'), 'no-store')
		const html = await response.text()
		assert.ok(!html.includes('/build/client-entry.js'))
		assert.ok(html.includes('fixture browser &lt;&amp;&gt;'))
		assert.ok(!html.includes('fixture browser <&>'))
		assert.ok(html.includes('unknown'))
		assert.ok(html.includes('Account sections'))
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
			([form]) => form,
		)
		assert.equal(forms.length, 3)
		for (const form of forms) {
			assert.ok(form.includes('method="post"'))
			assert.ok(form.includes('action="/account/sessions"'))
			assert.ok(form.includes('value="fixture-csrf"'))
		}
		for (const id of ['fixture-current', 'fixture-other']) {
			assert.ok(
				forms.some(
					(form) =>
						form.includes(`value="${id}"`) && form.includes('value="revoke"'),
				),
			)
			assert.ok(
				forms.some(
					(form) =>
						form.includes(`value="${id}"`) &&
						form.includes(id === 'fixture-current' ? 'Sign out' : 'Revoke'),
				),
			)
		}
		assert.ok(forms.some((form) => form.includes('value="revoke_others"')))
		assert.ok(!html.includes('Are you sure?'))
	})

	it('renders an empty session list without inventing per-device actions', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/account/sessions'),
			{
				title: 'Browser sessions',
				pathname: '/account/sessions',
				data: { page: 'accountSessions', csrf: 'fixture-csrf', sessions: [] },
			},
		)
		const html = await response.text()
		assert.ok(html.includes('No sessions.'))
		assert.ok(!html.includes('name="sessionId"'))
		assert.ok(html.includes('value="revoke_others"'))
	})

	it('renders console issuance and dispatch with native CSRF forms and escaped one-time values', async () => {
		const user = {
			id: 'fixture-user',
			email: 'fixture+<&>@example.invalid',
			createdAt: '2026-01-01T00:00:00.000Z',
		}
		for (const kind of ['invite', 'token'] as const) {
			const issuedValue = 'inert fixture display <&>'
			const response = await renderStartDocument(
				new Request('http://localhost/console'),
				{
					title: 'Users',
					pathname: '/console',
					data: {
						page: 'adminUsers',
						csrf: 'fixture-csrf',
						users: [user],
						issued: {
							kind,
							label: user.email,
							value: issuedValue,
							expiresAt: kind === 'invite' ? user.createdAt : null,
						},
					},
				},
			)
			assert.equal(response.status, 200)
			assert.equal(response.headers.get('cache-control'), 'no-store')
			const html = await response.text()
			assert.ok(html.includes('fixture+&lt;&amp;&gt;@example.invalid'))
			assert.ok(html.includes('inert fixture display &lt;&amp;&gt;'))
			assert.ok(!html.includes(issuedValue))
			assert.ok(html.includes('<script src="/one-time-document.js"></script>'))
			assert.ok(
				html.indexOf('src="/one-time-document.js"') < html.indexOf('<body>'),
			)
			assert.ok(
				html.includes(
					`Copy ${kind === 'invite' ? 'sign-in link' : 'API token'}`,
				),
			)
			assert.ok(html.includes('Copy user id'))
			assert.ok(html.includes('class="site-header'))
			assert.ok(!html.includes('/build/client-entry.js'))
			const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
				([form]) => form,
			)
			assert.equal(forms.length, 5)
			for (const form of forms) {
				assert.ok(form.includes('method="post"'))
				assert.ok(form.includes('name="csrf"'))
				assert.ok(form.includes('value="fixture-csrf"'))
			}
			for (const action of ['invite', 'token', 'create', 'dispatch']) {
				assert.ok(
					forms.some(
						(form) =>
							form.includes('name="action"') &&
							form.includes(`value="${action}"`),
					),
					action,
				)
			}
		}
	})

	it('renders the empty console without a stale issuance panel', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/console'),
			{
				title: 'Users',
				pathname: '/console',
				data: {
					page: 'adminUsers',
					csrf: 'fixture-csrf',
					users: [],
					issued: null,
				},
			},
		)
		const html = await response.text()
		assert.ok(html.includes('No users yet.'))
		assert.ok(!html.includes('Copy API token'))
		assert.ok(!html.includes('Copy sign-in link'))
		assert.ok(!html.includes('src="/one-time-document.js"'))
	})

	it('renders user detail approvals and destructive actions as native CSRF forms', async () => {
		const action = '/console/users/fixture-user'
		const response = await renderStartDocument(
			new Request(`http://localhost${action}`),
			{
				title: 'User',
				pathname: '/console',
				data: {
					page: 'adminUserDetail',
					csrf: 'fixture-csrf',
					action,
					user: {
						id: 'fixture-user',
						email: 'fixture+<&>@example.invalid',
						createdAt: '2026-01-01T00:00:00.000Z',
					},
					counts: { tokens: 0, grants: 0, sessions: 0, jobs: 0, runsToday: 0 },
					hosts: [
						{
							host: 'api.example.invalid',
							approvedAt: '2026-01-01T00:00:00.000Z',
							approvedBy: 'admin',
						},
					],
					quotas: defaultQuotas,
				},
			},
		)
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('cache-control'), 'no-store')
		const html = await response.text()
		assert.ok(html.includes('fixture+&lt;&amp;&gt;@example.invalid'))
		assert.ok(html.includes('Copy user id'))
		assert.ok(html.includes('class="site-header'))
		assert.ok(!html.includes('/build/client-entry.js'))
		const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
			([form]) => form,
		)
		assert.equal(forms.length, 4)
		for (const form of forms) {
			assert.ok(form.includes('method="post"'))
			assert.ok(form.includes('name="csrf"'))
			assert.ok(form.includes('value="fixture-csrf"'))
		}
		for (const operation of [
			'revoke_sessions',
			'revoke_host',
			'approve_host',
		]) {
			assert.ok(
				forms.some(
					(form) =>
						form.includes(`action="${action}"`) &&
						form.includes(`value="${operation}"`),
				),
				operation,
			)
		}
		assert.ok(html.includes('Sign out everywhere'))
		assert.ok(html.includes('Revoke'))
		assert.ok(!html.includes('Confirm revoke'))
	})

	it('renders console login and read-only documents with native forms and the correct shell', async () => {
		const cases: Array<{
			path: string
			data: AppLoaderData
			text: string
			status?: number
		}> = [
			{ path: '/console', data: { page: 'adminLogin' }, text: 'name="token"' },
			{
				path: '/console/signin',
				data: { page: 'adminLogin' },
				text: 'name="token"',
				status: 401,
			},
			{
				path: '/console/audit',
				data: {
					page: 'adminAudit',
					csrf: 'fixture-csrf',
					entries: [
						{
							id: 'fixture-audit',
							at: '2026-01-01T00:00:00.000Z',
							actor: 'admin',
							action: 'console.signin',
							target: null,
							details: null,
						},
					],
				},
				text: 'console.signin',
			},
			{
				path: '/console/config',
				data: {
					page: 'adminConfig',
					csrf: 'fixture-csrf',
					version: 'fixture',
					publicUrl: 'http://localhost',
					sections: [{ name: 'email', json: '{"adapter":"noop"}' }],
				},
				text: 'Adapter settings',
			},
		]
		for (const { path, data, text, status = 200 } of cases) {
			const response = await renderStartDocument(
				new Request('http://localhost' + path),
				{ title: 'Console', pathname: path, data, status },
			)
			assert.equal(response.status, status, path)
			const html = await response.text()
			assert.ok(html.includes(text), path)
			assert.equal(
				html.includes('class="site-header'),
				data.page !== 'adminLogin',
				path,
			)
			assert.ok(html.includes('<form method="post"'), path)
			assert.ok(!html.includes('/build/client-entry.js'), path)
			if (data.page === 'adminLogin') {
				const input = html.match(/<input\b[^>]*\bname="token"[^>]*>/)?.[0]
				assert.ok(input, path)
				assert.ok(input.includes('type="password"'), path)
				assert.ok(!/\svalue=/.test(input), path)
			} else assert.ok(html.includes('name="csrf"'), path)
		}
	})

	it('renders native auth and connect forms without site header or legacy scripts', async () => {
		const cases: Array<{ path: string; data: AppLoaderData; text: string }> = [
			{
				path: '/signin',
				data: {
					page: 'login',
					next: '/account',
					email: 'fixture@example.invalid',
					magicLinks: true,
				},
				text: 'name="intent"',
			},
			{
				path: '/setup',
				data: { page: 'setup', passwordMinLength: 12 },
				text: 'name="adminToken"',
			},
			{
				path: '/signin/link/expired',
				data: { page: 'signinLinkExpired' },
				text: 'Link expired',
			},
			{
				path: '/oauth/authorize',
				data: {
					page: 'oauthAuthorizeError',
					error: 'invalid_request',
					description: 'Invalid client',
				},
				text: 'Cannot authorize this client',
			},
			{
				path: '/connect/oauth/fixture-user/fixture-connect',
				data: {
					page: 'connectOauth',
					name: 'fixture',
					provider: 'Fixture provider',
					email: 'fixture@example.invalid',
					hosts: ['api.example.invalid'],
					scopes: ['read'],
					description: 'Local fixture',
					ticket: 'fixture-ticket',
					expiresAt: '2026-01-01T00:00:00.000Z',
				},
				text: 'name="ticket"',
			},
			{
				path: '/connect/oauth/callback',
				data: {
					page: 'connectOauthDone',
					name: 'fixture',
					provider: 'Fixture provider',
					email: 'fixture@example.invalid',
				},
				text: 'Connected fixture',
			},
			{
				path: '/connect/oauth/callback',
				data: {
					page: 'connectOauthError',
					error: 'invalid_request',
					message: 'Invalid provider',
				},
				text: 'Invalid provider',
			},
			{
				path: '/connect/secret-set',
				data: {
					page: 'connectSecretSet',
					csrf: 'fixture-csrf',
					name: 'fixture',
					description: null,
					scope: 'user',
					packageId: null,
					hosts: [],
					unsupportedNote: null,
					error: null,
					saved: false,
					canSubmit: true,
				},
				text: 'type="password"',
			},
		]
		for (const { path, data, text } of cases) {
			const response = await renderStartDocument(
				new Request(`http://localhost${path}`),
				{ title: 'Auth', pathname: path, data },
			)
			assert.equal(response.status, 200, path)
			const html = await response.text()
			assert.ok(html.startsWith('<!DOCTYPE html>'), path)
			assert.ok(html.includes(text), path)
			assert.ok(!html.includes('<header'), path)
			assert.ok(!html.includes('/build/client-entry.js'), path)
			if (data.page === 'connectOauth') {
				assert.ok(html.includes('<form method="post"'), path)
				assert.ok(html.includes('type="hidden" name="ticket"'), path)
			}
			if (data.page === 'connectSecretSet') {
				assert.ok(html.includes('name="csrf"'), path)
				const input = html.match(/<input\b[^>]*\bname="value"[^>]*>/)?.[0]
				assert.ok(input, path)
				assert.ok(!/\svalue=/.test(input), path)
			}
		}
	})
	it('preserves OAuth consent form-action and request nonce together', async () => {
		const response = await renderStartDocument(
			new Request('http://localhost/oauth/authorize'),
			{
				title: 'Connect client',
				pathname: '/oauth/authorize',
				data: {
					page: 'oauthAuthorize',
					clientName: 'fixture',
					clientUri: null,
					redirectHost: 'alice:',
					action: '/oauth/authorize',
					csrf: 'fixture-csrf',
					q: 'fixture-query',
					sig: 'fixture-signature',
				},
				headers: {
					'content-security-policy': contentSecurityPolicyWithFormAction([
						'alice:',
					]),
				},
			},
		)
		assert.equal(response.status, 200)
		const policy = response.headers.get('content-security-policy')!
		assert.ok(
			policy.includes(
				"form-action 'self' https: http://localhost:* http://127.0.0.1:* alice:",
			),
		)
		const nonce = policy.match(/'nonce-([a-f0-9]{32})'/)?.[1]
		assert.ok(nonce)
		const html = await response.text()
		assert.ok(html.includes('name="csrf"'))
		assert.ok(html.includes('name="sig"'))
		assert.ok(html.includes('name="decision"'))
		assert.ok(html.includes(`nonce="${nonce}"`))
		assert.ok(!html.includes('<header'))
	})
	it('lets a long unbroken OAuth client name wrap in the consent title (#159)', async () => {
		const clientName = 'A'.repeat(120)
		const response = await renderStartDocument(
			new Request('http://localhost/oauth/authorize'),
			{
				title: 'Connect client',
				pathname: '/oauth/authorize',
				data: {
					page: 'oauthAuthorize',
					clientName,
					clientUri: null,
					redirectHost: 'alice:',
					action: '/oauth/authorize',
					csrf: 'fixture-csrf',
					q: 'fixture-query',
					sig: 'fixture-signature',
				},
				headers: {},
			},
		)
		const html = await response.text()
		const heading = html.indexOf(`Connect ${clientName}</h1>`)
		assert.ok(heading > 0)
		const wrapper = [
			...html.slice(0, heading).matchAll(/<div class="(css-[\w-]+)">/g),
		].at(-1)?.[1]
		assert.ok(wrapper, 'title wrapper div not found')
		const rule = html.match(new RegExp(`\\.${wrapper}\\{([^}]*)\\}`))?.[1] ?? ''
		assert.ok(
			rule.includes('overflow-wrap:anywhere'),
			`title wrapper must wrap long words: ${rule}`,
		)
	})

	it('clips decorative bleed at <main> so pages never widen the viewport (#156)', async () => {
		const html = await (await render()).text()
		const main = html.match(/<main id="main" class="(css-[\w-]+)"/)?.[1]
		assert.ok(main, 'main element not found')
		const rule = html.match(new RegExp(`\\.${main}\\{([^}]*)\\}`))?.[1] ?? ''
		assert.ok(
			rule.includes('overflow-x:clip'),
			`main must clip horizontal overflow: ${rule}`,
		)
	})

	it('renders the hosted brand guide with the celld document and native links', async () => {
		for (const pathname of [
			'/brand-guide',
			'/brand-guide/',
			'/brand-guide?view=assets',
		]) {
			const response = await render(pathname)
			assert.equal(response.status, 200)
			assert.equal(response.headers.get('location'), null)
			assert.equal(
				response.headers.get('content-type'),
				'text/html; charset=utf-8',
			)
			assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
			for (const key of [
				'cache-control',
				'x-frame-options',
				'x-content-type-options',
			]) {
				assert.equal(response.headers.get(key), firstPartySecurityHeaders[key])
			}
			const html = await response.text()
			assert.ok(html.startsWith('<!DOCTYPE html>'))
			assert.equal(html.match(/<!DOCTYPE html>/g)?.length, 1)
			assert.ok(html.includes('<title>Brand guide · Kody</title>'))
			assert.ok(html.includes('data-emotion='))
			assert.ok(html.includes('name="robots" content="noindex"'))
			assert.ok(html.includes('href="/styles.css"'))
			assert.ok(html.includes('src="/page-init.js"'))
			assert.ok(html.includes('/build/start/assets/'))
			assert.ok(!html.includes('/build/client-entry.js'))
			assert.ok(html.includes('href="/signin"'))
			assert.ok(html.includes('href="/community"'))
			assert.ok(html.includes('github.com/kody-hq/kody-celld'))
			const csp = response.headers.get('content-security-policy')!
			const nonce = csp.match(/'nonce-([a-f0-9]{32})'/)?.[1]
			assert.ok(nonce)
			const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
			assert.ok(scripts.length > 1)
			for (const [, attributes] of scripts) {
				if (
					attributes?.includes('src="/page-init.js"') ||
					attributes?.includes('src="/emotion-style-hoist.js"')
				)
					continue
				assert.ok(attributes?.includes(`nonce="${nonce}"`), attributes)
			}
		}
	})
	it('isolates concurrent session and nonce contexts and escapes hostile strings', async () => {
		const names = Array.from(
			{ length: 8 },
			(_, i) => `identity-${i}-<img src=x onerror=alert(1)>`,
		)
		const results = await Promise.all(
			names.map(async (name) => {
				const response = await render('/brand-guide', name)
				return {
					html: await response.text(),
					csp: response.headers.get('content-security-policy')!,
				}
			}),
		)
		assert.equal(new Set(results.map((r) => r.csp)).size, names.length)
		for (const [i, result] of results.entries()) {
			assert.ok(result.html.includes(`identity-${i}-&lt;img`))
			assert.ok(!result.html.includes('<img src=x onerror=alert(1)>'))
			assert.ok(result.html.includes('href="/console"'))
			assert.ok(result.html.includes('href="/account"'))
			for (const j of names.keys()) {
				if (i !== j) assert.ok(!result.html.includes(`identity-${j}-`))
			}
		}
	})
	it('refuses to render a document without its matching request nonce', async () => {
		const { default: server } = await import('#start-server')
		const response = await server.fetch(
			new Request('http://localhost/brand-guide'),
			{
				context: {
					nonce: '',
					document: {
						title: 'Invalid',
						timestampLocale: getDocumentTimestampLocale(),
						pathname: '/brand-guide',
						data: { page: 'brandGuide' },
						session: null,
						flash: null,
						version: 'test',
					},
				},
			},
		)
		assert.equal(response.status, 500)
		assert.ok(!(await response.text()).includes('<!DOCTYPE html>'))
	})
})
