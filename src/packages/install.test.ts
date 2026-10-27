import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { KodyError } from '../lib/errors.ts'
import {
	assertAllowedSourceUrl,
	commitShaFromCodeloadUrl,
	createSourceHopGuard,
	defaultPackageSourceHosts,
	describePackageSource,
	fetchAllowed,
	fetchPackageSource,
	filesFromJson,
	githubTarballUrl,
	packageFileView,
	packagePreviewFromFetched,
	packageSourceHostPolicyFromEnv,
	packageSourceHostsFromEnv,
	parsePackageSource,
	pinPackageSourceToCommit,
	previewPackageSource,
	resolveGithubCommitSha,
	type FetchLike,
} from './install.ts'
import { gunzip, readTar } from './tar.ts'

const manifest = JSON.stringify({ name: '@t/hello', version: '1.2.3', exports: { '.': './main.js' } })

/** Builds a GitHub-shaped tarball (`repo-ref/…` root dir) with the system tar. */
function githubTarball(files: Record<string, string | Uint8Array>, root = 'hello-HEAD') {
	const dir = mkdtempSync(join(tmpdir(), 'kody-tar-'))
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, root, path)
		mkdirSync(join(full, '..'), { recursive: true })
		writeFileSync(full, content)
	}
	const out = join(dir, 'archive.tgz')
	execFileSync('tar', ['-czf', out, '-C', dir, root])
	return new Uint8Array(readFileSync(out))
}

const packageFiles = {
	'package.json': manifest,
	'README.md': '# hello',
	'AGENTS.md': 'agents',
	'main.js': 'export default async () => "hi"',
	'.git/config': '[core]',
	'node_modules/x/index.js': 'nope',
	'image.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]),
}

const dnsResolverUrl = 'https://dns.test/dns-query'

/**
 * Routes source URLs to canned responses (recorded in `calls`) and answers DNS-over-HTTPS
 * lookups at `dnsResolverUrl` from `dns` (recorded in `dnsQueries`). Unlisted names resolve
 * to a public address; `null` answers with an HTTP error.
 */
function fetchFor(
	routes: Record<string, () => Response>,
	dns: Record<string, Array<string> | null> = {},
): FetchLike & { calls: Array<string>; dnsQueries: Array<string> } {
	const calls: Array<string> = []
	const dnsQueries: Array<string> = []
	const impl: FetchLike = async (input) => {
		const url = new URL(input)
		if (url.origin + url.pathname === dnsResolverUrl) {
			const name = url.searchParams.get('name') ?? ''
			const type = url.searchParams.get('type')
			dnsQueries.push(`${name}/${type}`)
			const addresses = name in dns ? dns[name] : ['93.184.216.34']
			if (!addresses) return new Response('down', { status: 502 })
			const wanted = addresses.filter((address) => address.includes(':') === (type === 'AAAA'))
			return Response.json({ Status: 0, Answer: wanted.map((data) => ({ type: type === 'AAAA' ? 28 : 1, data })) })
		}
		calls.push(input)
		const route = routes[input]
		return route ? route() : new Response('not found', { status: 404 })
	}
	return Object.assign(impl, { calls, dnsQueries })
}

const tgzResponse = (bytes: Uint8Array) => () =>
	new Response(bytes, { status: 200, headers: { 'content-type': 'application/x-gzip' } })

describe('parsePackageSource', () => {
	it('parses github: shorthand with subdir and ref', () => {
		assert.deepEqual(parsePackageSource('github:kody-hq/kody-celld'), {
			kind: 'github',
			owner: 'kody-hq',
			repo: 'kody-celld',
			ref: null,
			subdir: null,
		})
		const full = parsePackageSource('github:kody-hq/kody-celld/examples/hello#v1.0.0')
		assert.deepEqual(full, {
			kind: 'github',
			owner: 'kody-hq',
			repo: 'kody-celld',
			ref: 'v1.0.0',
			subdir: 'examples/hello',
		})
		assert.equal(describePackageSource(full), 'github:kody-hq/kody-celld/examples/hello#v1.0.0')
		assert.ok(full.kind === 'github')
		assert.equal(githubTarballUrl(full), 'https://codeload.github.com/kody-hq/kody-celld/tar.gz/v1.0.0')
		const bare = parsePackageSource('github:a/b')
		assert.ok(bare.kind === 'github')
		assert.equal(githubTarballUrl(bare), 'https://codeload.github.com/a/b/tar.gz/HEAD')
	})

	it('parses github.com URLs including /tree/<ref>/<subdir>', () => {
		assert.deepEqual(parsePackageSource('https://github.com/kody-hq/kody-celld.git'), {
			kind: 'github',
			owner: 'kody-hq',
			repo: 'kody-celld',
			ref: null,
			subdir: null,
		})
		assert.deepEqual(parsePackageSource('https://github.com/kody-hq/kody-celld/tree/main/examples/hello'), {
			kind: 'github',
			owner: 'kody-hq',
			repo: 'kody-celld',
			ref: 'main',
			subdir: 'examples/hello',
		})
		// Other github.com paths (releases, raw blobs) are plain URLs.
		assert.equal(parsePackageSource('https://github.com/a/b/releases/download/v1/pkg.tgz').kind, 'url')
	})

	it('parses public kody.codes listing and .git URLs', () => {
		assert.deepEqual(parsePackageSource('https://kody.codes/@kody/cloudflare'), {
			kind: 'kody',
			origin: 'https://kody.codes',
			owner: 'kody',
			name: 'cloudflare',
			ref: null,
			subdir: null,
			gitUrl: 'https://kody.codes/@kody/cloudflare.git',
		})
		assert.deepEqual(parsePackageSource('https://kody.codes/@kody/cloudflare.git#main'), {
			kind: 'kody',
			origin: 'https://kody.codes',
			owner: 'kody',
			name: 'cloudflare',
			ref: 'main',
			subdir: null,
			gitUrl: 'https://kody.codes/@kody/cloudflare.git',
		})
		assert.deepEqual(parsePackageSource('kody:@kody/cloudflare#v1'), {
			kind: 'kody',
			origin: 'https://kody.codes',
			owner: 'kody',
			name: 'cloudflare',
			ref: 'v1',
			subdir: null,
			gitUrl: 'https://kody.codes/@kody/cloudflare.git',
		})
		assert.deepEqual(parsePackageSource('https://kody.codes/@kody/cloudflare/tree/main/packages/hello'), {
			kind: 'kody',
			origin: 'https://kody.codes',
			owner: 'kody',
			name: 'cloudflare',
			ref: 'main',
			subdir: 'packages/hello',
			gitUrl: 'https://kody.codes/@kody/cloudflare.git',
		})
		assert.equal(
			describePackageSource(parsePackageSource('https://kody.codes/@kody/cloudflare')),
			'https://kody.codes/@kody/cloudflare.git',
		)
		assert.equal(
			describePackageSource(parsePackageSource('https://kody.codes/@kody/cloudflare/tree/main/packages/hello')),
			'https://kody.codes/@kody/cloudflare/tree/main/packages/hello',
		)
		assert.equal(defaultPackageSourceHosts.includes('kody.codes'), true)
	})

	it('treats everything else as a URL source and strips the fragment', () => {
		const source = parsePackageSource('https://example.com/pkg.json#frag', 'sub/')
		assert.deepEqual(source, { kind: 'url', url: 'https://example.com/pkg.json', subdir: 'sub' })
		assert.equal(describePackageSource(source), 'https://example.com/pkg.json#sub')
	})

	it('rejects malformed sources', () => {
		assert.throws(() => parsePackageSource(''), /non-empty/)
		assert.throws(() => parsePackageSource('github:onlyowner'), /github:owner\/repo/)
		assert.throws(() => parsePackageSource('github:a/b#../x'), /valid git ref/)
		assert.throws(() => parsePackageSource('github:a/b#-flag'), /valid git ref/)
		assert.throws(() => parsePackageSource('github:a/b/../etc'), /may not contain/)
		assert.throws(() => parsePackageSource('github:bad owner/b'), /owner name/)
		assert.throws(() => parsePackageSource('ftp://example.com/x.tgz'), /Only http\(s\)/)
		assert.throws(() => parsePackageSource('https://user:pw@example.com/x.tgz'), /credentials/)
		assert.throws(() => parsePackageSource('not a url'), /not a URL/)
		assert.throws(() => parsePackageSource('kody:@only'), /kody:@owner\/leaf/)
	})
})

describe('source host policy', () => {
	it('defaults to GitHub hosts and refuses the removed package-source env var', () => {
		assert.deepEqual(packageSourceHostsFromEnv({}), defaultPackageSourceHosts)
		assert.throws(
			() => packageSourceHostsFromEnv({ KODY_PACKAGE_SOURCE_HOSTS: 'example.com' }),
			/KODY_PACKAGE_SOURCE_HOSTS.*KODY_PRIVATE_HOSTS.*issues\/62/,
		)
	})

	it('refuses private hosts even when the public allowlist is *', () => {
		for (const url of [
			'http://localhost/pkg.tgz',
			'http://127.0.0.1/pkg.tgz',
			'http://10.1.2.3/pkg.tgz',
			'http://169.254.169.254/latest',
			'http://[::1]/pkg.tgz',
			'http://minio/pkg.tgz',
			'http://kody.internal/pkg.tgz',
		]) {
			assert.throws(() => assertAllowedSourceUrl(url, ['*']), /package_source_refused/, url)
		}
	})

	it('lets the operator allowlist a LAN host via KODY_PRIVATE_HOSTS (exact, suffix, CIDR)', () => {
		assert.ok(assertAllowedSourceUrl('http://gitea.local/pkg.tgz', ['*'], ['gitea.local']))
		assert.ok(assertAllowedSourceUrl('http://192.168.1.20:3000/pkg.tgz', ['*'], ['192.168.1.20']))
		assert.ok(assertAllowedSourceUrl('http://nas.lab.home/pkg.tgz', ['*'], ['*.lab.home']))
		assert.ok(assertAllowedSourceUrl('http://172.30.1.5/pkg.tgz', ['*'], ['172.30.0.0/16']))
		assert.throws(() => assertAllowedSourceUrl('http://gitea.local/pkg.tgz', ['*.local']), /private host/)
		assert.throws(() => assertAllowedSourceUrl('http://gitea.local/pkg.tgz', ['*']), /private host/)
	})

	it('enforces the public allowlist with exact and wildcard entries', () => {
		assert.throws(
			() => assertAllowedSourceUrl('https://evil.example/x.tgz', defaultPackageSourceHosts),
			/not an allowed package source host/,
		)
		assert.ok(assertAllowedSourceUrl('https://codeload.github.com/a/b/tar.gz/HEAD', defaultPackageSourceHosts))
		assert.ok(assertAllowedSourceUrl('https://cdn.pkgs.test/x.tgz', ['*.pkgs.test']))
		assert.throws(() => assertAllowedSourceUrl('https://pkgs.test/x.tgz', ['*.pkgs.test']), /not an allowed/)
		assert.throws(() => assertAllowedSourceUrl('https://u:p@github.com/x', ['*']), /credentials/)
	})

	it('re-checks every redirect hop and caps the chain', async () => {
		const bytes = new TextEncoder().encode('{}')
		const fetchImpl = fetchFor({
			'https://github.com/a/b/archive/main.tar.gz': () =>
				new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/a/b/tar.gz/main' } }),
			'https://codeload.github.com/a/b/tar.gz/main': () => new Response(bytes, { status: 200 }),
			'https://github.com/a/b/evil': () =>
				new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }),
			'https://github.com/a/b/loop': () => new Response(null, { status: 302, headers: { location: '/a/b/loop' } }),
		})
		const guard = createSourceHopGuard({ allowedHosts: defaultPackageSourceHosts, dnsResolverUrl, fetch: fetchImpl })
		const ok = await fetchAllowed('https://github.com/a/b/archive/main.tar.gz', guard, fetchImpl)
		assert.equal(ok.url, 'https://codeload.github.com/a/b/tar.gz/main')
		await assert.rejects(fetchAllowed('https://github.com/a/b/evil', guard, fetchImpl), /private host/)
		await assert.rejects(fetchAllowed('https://github.com/a/b/loop', guard, fetchImpl), /Too many redirects/)
		await assert.rejects(fetchAllowed('https://github.com/a/b/missing', guard, fetchImpl), (error: Error) => {
			assert.equal(error.name, 'KodyError:package_source_failed:404')
			return true
		})
	})
})

describe('source host resolution', () => {
	const base = { allowedHosts: ['*'], dnsResolverUrl }

	it('reads KODY_DNS_RESOLVER_URL into the policy and refuses a non-https resolver', () => {
		assert.equal(packageSourceHostPolicyFromEnv({}).dnsResolverUrl, 'https://cloudflare-dns.com/dns-query')
		assert.equal(
			packageSourceHostPolicyFromEnv({ KODY_DNS_RESOLVER_URL: 'https://dns.lan/dns-query' }).dnsResolverUrl,
			'https://dns.lan/dns-query',
		)
		assert.throws(
			() => packageSourceHostPolicyFromEnv({ KODY_DNS_RESOLVER_URL: 'http://dns.lan/dns-query' }),
			/config_error.*KODY_DNS_RESOLVER_URL/,
		)
	})

	it('refuses a public name that resolves to a private, loopback, link-local, CGNAT or mapped address', async () => {
		for (const address of [
			'10.0.0.5',
			'127.0.0.1',
			'169.254.169.254',
			'100.64.0.1',
			'::1',
			'fd00::1',
			'::ffff:a00:5',
		]) {
			const fetchImpl = fetchFor({}, { 'pkgs.example': [address] })
			const guard = createSourceHopGuard({ ...base, fetch: fetchImpl })
			await assert.rejects(fetchAllowed('https://pkgs.example/x.tgz', guard, fetchImpl), (error: Error) => {
				assert.equal(error.name, 'KodyError:package_source_refused:403')
				assert.match(error.message, /resolves to private address/)
				return true
			})
			assert.deepEqual(fetchImpl.calls, [], `${address} must be refused before any request`)
		}
	})

	it('refuses a redirect to a name that resolves privately, even on a built-in host', async () => {
		const fetchImpl = fetchFor(
			{
				'https://github.com/a/b/archive/main.tar.gz': () =>
					new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/a/b/tar.gz/main' } }),
			},
			{ 'codeload.github.com': ['192.168.1.9'] },
		)
		const guard = createSourceHopGuard({ allowedHosts: defaultPackageSourceHosts, dnsResolverUrl, fetch: fetchImpl })
		await assert.rejects(
			fetchAllowed('https://github.com/a/b/archive/main.tar.gz', guard, fetchImpl),
			/codeload\.github\.com" resolves to private address 192\.168\.1\.9/,
		)
		assert.deepEqual(fetchImpl.calls, ['https://github.com/a/b/archive/main.tar.gz'])
	})

	it('refuses when the lookup fails or returns nothing', async () => {
		const failing = createSourceHopGuard({ ...base, fetch: fetchFor({}, { 'pkgs.example': null }) })
		await assert.rejects(failing('https://pkgs.example/x.tgz'), /Could not resolve "pkgs\.example".*resolver HTTP 502/)
		const empty = createSourceHopGuard({ ...base, fetch: fetchFor({}, { 'pkgs.example': [] }) })
		await assert.rejects(empty('https://pkgs.example/x.tgz'), /no A\/AAAA records/)
	})

	it('lets KODY_PRIVATE_HOSTS allow a resolved range, and skips the lookup for listed names and IP literals', async () => {
		const fetchImpl = fetchFor({}, { 'git.example': ['172.30.1.5'] })
		const guard = createSourceHopGuard({
			...base,
			privateHosts: ['172.30.0.0/16', 'gitea.local', '192.168.1.20'],
			fetch: fetchImpl,
		})
		assert.equal(await guard('https://git.example/x.tgz'), 'https://git.example/x.tgz')
		assert.equal(await guard('http://gitea.local/x.tgz'), 'http://gitea.local/x.tgz')
		assert.equal(await guard('http://192.168.1.20:3000/x.tgz'), 'http://192.168.1.20:3000/x.tgz')
		assert.deepEqual(fetchImpl.dnsQueries.sort(), ['git.example/A', 'git.example/AAAA'])
	})

	it('reuses answers within one install only', async () => {
		const fetchImpl = fetchFor({})
		const guard = createSourceHopGuard({ ...base, fetch: fetchImpl })
		await guard('https://pkgs.example/a.tgz')
		await guard('https://pkgs.example/b.tgz')
		assert.equal(fetchImpl.dnsQueries.length, 2)
		await createSourceHopGuard({ ...base, fetch: fetchImpl })('https://pkgs.example/a.tgz')
		assert.equal(fetchImpl.dnsQueries.length, 4)
	})

	it('checks every hop of the GitHub commit lookup', async () => {
		const routes = {
			'https://api.github.com/repos/o/moved/commits/HEAD': () =>
				new Response(null, {
					status: 301,
					headers: { location: 'https://api.github.com/repositories/1/commits/HEAD' },
				}),
			'https://api.github.com/repositories/1/commits/HEAD': () => new Response(exampleCommit, { status: 200 }),
		}
		const source = { kind: 'github' as const, owner: 'o', repo: 'moved', ref: null, subdir: null }
		const options = { allowedHosts: defaultPackageSourceHosts, dnsResolverUrl }
		assert.equal(await resolveGithubCommitSha(source, { ...options, fetch: fetchFor(routes) }), exampleCommit)
		const privateApi = fetchFor(routes, { 'api.github.com': ['10.0.0.1'] })
		assert.equal(await resolveGithubCommitSha(source, { ...options, fetch: privateApi }), undefined)
		assert.deepEqual(privateApi.calls, [])
	})

	it('checks resolved addresses on kody: git clones', async () => {
		const fetchImpl = fetchFor({}, { 'kody.codes': ['127.0.0.1'] })
		await assert.rejects(
			fetchPackageSource(parsePackageSource('kody:@t/hello'), {
				allowedHosts: defaultPackageSourceHosts,
				dnsResolverUrl,
				fetch: fetchImpl,
			}),
			/kody\.codes" resolves to private address 127\.0\.0\.1/,
		)
		assert.deepEqual(fetchImpl.calls, [])
	})
})

describe('tar reading', () => {
	it('extracts regular files from a gzip tarball, including long paths', async () => {
		const longPath = `${'deeply/'.repeat(20)}file.js`
		const bytes = githubTarball({ 'a.txt': 'A', [longPath]: 'long' })
		const entries = readTar(await gunzip(bytes, 1024 * 1024), { maxFiles: 10, maxTotalBytes: 1024 })
		assert.deepEqual(
			entries.map((e) => [e.path, new TextDecoder().decode(e.bytes)]).sort(),
			[
				['hello-HEAD/a.txt', 'A'],
				[`hello-HEAD/${longPath}`, 'long'],
			].sort(),
		)
	})

	it('enforces file-count and byte limits', async () => {
		const bytes = await gunzip(githubTarball({ 'a.txt': 'A'.repeat(600), 'b.txt': 'B' }), 1024 * 1024)
		assert.throws(() => readTar(bytes, { maxFiles: 1, maxTotalBytes: 10_000 }), /more than 1 files/)
		assert.throws(() => readTar(bytes, { maxFiles: 10, maxTotalBytes: 100 }), /exceed 100 bytes/)
	})

	it('caps gunzip output', async () => {
		const bytes = githubTarball({ 'a.txt': 'A'.repeat(50_000) })
		await assert.rejects(gunzip(bytes, 10_000), /expands beyond/)
	})
})

const exampleCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('commit pin helpers', () => {
	it('reads a SHA from the final codeload URL and pins github/kody sources', () => {
		assert.equal(commitShaFromCodeloadUrl(`https://codeload.github.com/o/r/tar.gz/${exampleCommit}`), exampleCommit)
		assert.equal(commitShaFromCodeloadUrl('https://codeload.github.com/o/r/tar.gz/HEAD'), undefined)
		assert.equal(pinPackageSourceToCommit('github:o/hello', exampleCommit), `github:o/hello#${exampleCommit}`)
		assert.equal(
			pinPackageSourceToCommit('github:o/hello/packages/x#main', exampleCommit),
			`github:o/hello/packages/x#${exampleCommit}`,
		)
		assert.equal(
			pinPackageSourceToCommit(`github:o/hello#${exampleCommit}`, exampleCommit),
			`github:o/hello#${exampleCommit}`,
		)
		assert.equal(pinPackageSourceToCommit('https://example.com/pkg.tgz', exampleCommit), 'https://example.com/pkg.tgz')
	})
})

describe('fetchPackageSource', () => {
	it('installs a GitHub tarball: strips the root dir, skips .git/node_modules/binary files', async () => {
		const fetchImpl = fetchFor({
			'https://codeload.github.com/o/hello/tar.gz/HEAD': tgzResponse(githubTarball(packageFiles)),
		})
		const result = await fetchPackageSource(parsePackageSource('github:o/hello'), {
			allowedHosts: defaultPackageSourceHosts,
			dnsResolverUrl,
			fetch: fetchImpl,
		})
		assert.deepEqual(Object.keys(result.files).sort(), ['AGENTS.md', 'README.md', 'main.js', 'package.json'])
		assert.equal(result.files['package.json'], manifest)
		assert.equal(result.source, 'github:o/hello')
		assert.equal(result.fetchedFrom, 'https://codeload.github.com/o/hello/tar.gz/HEAD')
		assert.equal(result.commit, undefined)
		assert.deepEqual(result.warnings, ['Skipped image.png: not UTF-8 text (packages hold text files only).'])
	})

	it('records the commit when codeload redirects HEAD to a SHA', async () => {
		const fetchImpl = fetchFor({
			'https://codeload.github.com/o/hello/tar.gz/HEAD': () =>
				new Response(null, {
					status: 302,
					headers: { location: `https://codeload.github.com/o/hello/tar.gz/${exampleCommit}` },
				}),
			[`https://codeload.github.com/o/hello/tar.gz/${exampleCommit}`]: tgzResponse(githubTarball(packageFiles)),
		})
		const result = await fetchPackageSource(parsePackageSource('github:o/hello'), {
			allowedHosts: defaultPackageSourceHosts,
			dnsResolverUrl,
			fetch: fetchImpl,
		})
		assert.equal(result.commit, exampleCommit)
		assert.equal(result.fetchedFrom, `https://codeload.github.com/o/hello/tar.gz/${exampleCommit}`)
	})

	it('resolves the commit via the GitHub API before downloading when codeload would return 200 for HEAD', async () => {
		const fetchImpl = fetchFor({
			'https://api.github.com/repos/o/hello/commits/HEAD': () =>
				new Response(exampleCommit, {
					status: 200,
					headers: { 'content-type': 'application/vnd.github.sha' },
				}),
			[`https://codeload.github.com/o/hello/tar.gz/${exampleCommit}`]: tgzResponse(
				githubTarball(packageFiles, `hello-${exampleCommit}`),
			),
			// Must not be used: downloading HEAD then resolving SHA can pin a different tree.
			'https://codeload.github.com/o/hello/tar.gz/HEAD': tgzResponse(
				githubTarball({ 'package.json': '{"name":"@t/stale"}' }, 'hello-HEAD'),
			),
		})
		const result = await fetchPackageSource(parsePackageSource('github:o/hello'), {
			allowedHosts: defaultPackageSourceHosts,
			dnsResolverUrl,
			fetch: fetchImpl,
		})
		assert.equal(result.commit, exampleCommit)
		assert.equal(result.fetchedFrom, `https://codeload.github.com/o/hello/tar.gz/${exampleCommit}`)
		assert.equal(result.files['package.json'], manifest)
		assert.deepEqual(fetchImpl.calls, [
			'https://api.github.com/repos/o/hello/commits/HEAD',
			`https://codeload.github.com/o/hello/tar.gz/${exampleCommit}`,
		])
	})

	it('roots the package at subdir and suggests directories when package.json is elsewhere', async () => {
		const nested = Object.fromEntries(Object.entries(packageFiles).map(([p, c]) => [`packages/hello/${p}`, c]))
		nested['packages/other/package.json'] = '{}'
		const tarball = githubTarball(nested, 'mono-main')
		const fetchImpl = fetchFor({ 'https://codeload.github.com/o/mono/tar.gz/main': tgzResponse(tarball) })
		const ok = await fetchPackageSource(parsePackageSource('github:o/mono/packages/hello#main'), {
			allowedHosts: defaultPackageSourceHosts,
			dnsResolverUrl,
			fetch: fetchImpl,
		})
		assert.equal(ok.files['main.js'], packageFiles['main.js'])
		assert.equal(ok.source, 'github:o/mono/packages/hello#main')
		await assert.rejects(
			fetchPackageSource(parsePackageSource('github:o/mono#main'), {
				allowedHosts: defaultPackageSourceHosts,
				dnsResolverUrl,
				fetch: fetchImpl,
			}),
			/package\.json was found in: packages\/hello, packages\/other/,
		)
		await assert.rejects(
			fetchPackageSource(parsePackageSource('github:o/mono/nowhere#main'), {
				allowedHosts: defaultPackageSourceHosts,
				dnsResolverUrl,
				fetch: fetchImpl,
			}),
			/package\.json was found in: packages\/hello, packages\/other/,
		)
	})

	it('accepts JSON file maps, wrapped or bare', () => {
		const bare = filesFromJson(JSON.stringify({ 'package.json': manifest, 'README.md': 'r' }), null)
		assert.deepEqual(Object.keys(bare.files).sort(), ['README.md', 'package.json'])
		const wrapped = filesFromJson(JSON.stringify({ files: { './package.json': manifest }, source: 'x' }), null)
		assert.deepEqual(Object.keys(wrapped.files), ['package.json'])
		assert.throws(() => filesFromJson('[1]', null), /must be an object/)
		assert.throws(() => filesFromJson(JSON.stringify({ 'package.json': 1 }), null), /must be a string/)
		assert.throws(() => filesFromJson(JSON.stringify({ 'README.md': 'x' }), null), /no package\.json/)
		assert.throws(() => filesFromJson('garbage', null), /neither a tarball nor JSON/)
	})

	it('fetches JSON sources from allowlisted URLs', async () => {
		const fetchImpl = fetchFor({
			'https://raw.githubusercontent.com/o/r/main/pkg.json': () =>
				new Response(JSON.stringify({ 'package.json': manifest, 'README.md': 'r', 'AGENTS.md': 'a', 'main.js': 'x' }), {
					status: 200,
					headers: { 'content-type': 'text/plain' },
				}),
		})
		const result = await fetchPackageSource(parsePackageSource('https://raw.githubusercontent.com/o/r/main/pkg.json'), {
			allowedHosts: defaultPackageSourceHosts,
			dnsResolverUrl,
			fetch: fetchImpl,
		})
		assert.equal(result.files['main.js'], 'x')
		assert.equal(result.source, 'https://raw.githubusercontent.com/o/r/main/pkg.json')
	})

	it('never contacts hosts outside the allowlist', async () => {
		const fetchImpl = fetchFor({})
		await assert.rejects(
			fetchPackageSource(parsePackageSource('https://evil.example/pkg.tgz'), {
				allowedHosts: defaultPackageSourceHosts,
				dnsResolverUrl,
				fetch: fetchImpl,
			}),
			/package_source_refused/,
		)
		assert.deepEqual(fetchImpl.calls, [])
	})
})

describe('packageFileView', () => {
	it('returns one file of a package with its UTF-8 byte size', () => {
		const view = packageFileView({ 'package.json': manifest, 'main.js': 'export const é = 1\n' }, 'main.js')
		assert.deepEqual(view, { path: 'main.js', bytes: 20, content: 'export const é = 1\n', truncated: false })
	})

	it('truncates content at 200,000 characters and says so', () => {
		const big = 'x'.repeat(200_001)
		const view = packageFileView({ 'big.txt': big }, 'big.txt')
		assert.equal(view.content.length, 200_000)
		assert.equal(view.truncated, true)
		assert.equal(view.bytes, 200_001)
	})

	it('rejects paths that are not in the package', () => {
		assert.throws(
			() => packageFileView({ 'main.js': 'x' }, 'nope.js'),
			(error: unknown) =>
				error instanceof KodyError && error.code === 'package_file_not_found' && /nope\.js/.test(error.message),
		)
	})

	it('does not treat inherited object keys as package files', () => {
		for (const path of ['constructor', '__proto__', 'toString']) {
			assert.throws(() => packageFileView({ 'main.js': 'x' }, path), /was not found/)
		}
	})

	it('reads source files of a fetched preview before install', async () => {
		const fetchImpl = fetchFor({
			'https://codeload.github.com/o/hello/tar.gz/HEAD': tgzResponse(githubTarball(packageFiles)),
		})
		const preview = await previewPackageSource(parsePackageSource('github:o/hello'), {
			allowedHosts: defaultPackageSourceHosts,
			dnsResolverUrl,
			fetch: fetchImpl,
		})
		assert.equal(packageFileView(preview.files, 'main.js').content, packageFiles['main.js'])
	})
})

describe('packagePreviewFromFetched', () => {
	it('includes manifest parse warnings alongside fetch warnings', () => {
		const preview = packagePreviewFromFetched({
			files: {
				'package.json': JSON.stringify({ name: '@scope/pkg', version: '1.0.0', kody: { madeUp: true } }),
				'README.md': '# pkg',
				'AGENTS.md': '# pkg',
			},
			warnings: ['fetch warning'],
			source: 'https://example.com/pkg',
			fetchedFrom: 'https://example.com/pkg',
		})
		assert.equal(preview.warnings[0], 'fetch warning')
		assert(preview.warnings.some((warning) => warning.includes('kody.madeUp')))
	})
})
