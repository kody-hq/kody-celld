#!/usr/bin/env node
/**
 * Pin and verify files copied from kody-hq/kody.
 *
 *   npm run sync:kody          # pull from kody main, copy verbatim files, rewrite pins
 *   npm run sync:kody -- --commit <sha>
 *   npm run sync:kody -- --commit <sha> --only <path>   # re-pin one verbatim file
 *   npm run sync:kody:check    # fail if any pinned file differs from upstream
 *
 * Manifest: shared-from-kody.json at the repo root. A file entry may carry its
 * own `kodyCommit` (set by `--only`) when it was re-pinned ahead of the rest;
 * a full sync re-pins every file and drops those per-file commits.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(repoRoot, 'shared-from-kody.json')
const kodyRepo = 'kody-hq/kody'
const rawBase = `https://raw.githubusercontent.com/${kodyRepo}`

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const commitFlag = args.indexOf('--commit')
const commitOverride = commitFlag >= 0 ? args[commitFlag + 1] : null
const onlyFlag = args.indexOf('--only')
const onlyPath = onlyFlag >= 0 ? args[onlyFlag + 1] : null
const fullCommitShaPattern = /^[0-9a-f]{40}$/

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex')
}

/** Prettier JSON shape (2 spaces + trailing newline), keeping \uXXXX for non-ASCII. */
function serializeManifest(manifest) {
	const json = JSON.stringify(manifest, null, 2).replace(
		/[\u007f-\uffff]/g,
		(ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
	)
	return `${json}\n`
}

async function readManifest() {
	const raw = await readFile(manifestPath, 'utf8')
	return JSON.parse(raw)
}

async function fetchUpstream(commit, sourcePath) {
	const url = `${rawBase}/${commit}/${sourcePath}`
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`GET ${url} → ${res.status} ${res.statusText}`)
	}
	return Buffer.from(await res.arrayBuffer())
}

async function resolveMainCommit() {
	const res = await fetch(`https://api.github.com/repos/${kodyRepo}/commits/main`, {
		headers: {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'kody-celld-sync-kody',
		},
	})
	if (!res.ok) {
		throw new Error(`resolve main commit: ${res.status} ${res.statusText}`)
	}
	const body = await res.json()
	if (typeof body.sha !== 'string') {
		throw new Error('resolve main commit: missing sha')
	}
	return body.sha
}

async function check(manifest) {
	const { kodyCommit, files } = manifest
	let failed = 0
	const reports = []
	for (const entry of files) {
		const localPath = path.join(repoRoot, entry.path)
		let local
		try {
			local = await readFile(localPath)
		} catch (error) {
			failed += 1
			reports.push(`MISSING ${entry.path}: ${error.message}`)
			continue
		}
		const localHash = sha256(local)
		if (localHash !== entry.sha256) {
			failed += 1
			reports.push(`DRIFT ${entry.path}: local sha256 ${localHash.slice(0, 12)}… != pin ${entry.sha256.slice(0, 12)}…`)
			continue
		}
		const entryCommit = entry.kodyCommit ?? kodyCommit
		const upstream = await fetchUpstream(entryCommit, entry.source)
		const upstreamHash = sha256(upstream)
		if (upstreamHash !== entry.sha256) {
			failed += 1
			reports.push(
				`STALE PIN ${entry.path}: upstream@${entryCommit.slice(0, 8)} is ${upstreamHash.slice(0, 12)}… (pin ${entry.sha256.slice(0, 12)}…). Run npm run sync:kody`,
			)
			continue
		}
		if (!local.equals(upstream)) {
			failed += 1
			reports.push(`CONTENT ${entry.path}: local bytes differ from upstream@${entryCommit.slice(0, 8)}`)
			continue
		}
		reports.push(entry.kodyCommit ? `ok ${entry.path} @${entryCommit.slice(0, 8)}` : `ok ${entry.path}`)
	}
	for (const line of reports) {
		console.log(line)
	}
	if (failed > 0) {
		console.error(`\nsync:kody:check failed: ${failed} of ${files.length} verbatim file(s)`)
		process.exit(1)
	}
	console.log(`\nsync:kody:check passed: ${files.length} file(s) match ${kodyRepo}@${kodyCommit.slice(0, 8)}`)
}

async function update(manifest) {
	const commit = commitOverride ?? (await resolveMainCommit())
	console.log(`Pinning ${kodyRepo}@${commit}`)

	const updatedFiles = []
	const copied = []
	const unchanged = []
	for (const entry of manifest.files) {
		const upstream = await fetchUpstream(commit, entry.source)
		const hash = sha256(upstream)
		const localPath = path.join(repoRoot, entry.path)
		await mkdir(path.dirname(localPath), { recursive: true })
		let previous = null
		try {
			previous = await readFile(localPath)
		} catch {
			previous = null
		}
		await writeFile(localPath, upstream)
		if (previous && previous.equals(upstream)) {
			unchanged.push(entry.path)
		} else {
			copied.push(entry.path)
		}
		const { kodyCommit: _filePin, ...rest } = entry
		updatedFiles.push({
			...rest,
			sha256: hash,
		})
	}

	const adaptedReports = []
	for (const entry of manifest.adapted ?? []) {
		try {
			const upstream = await fetchUpstream(commit, entry.source)
			const local = await readFile(path.join(repoRoot, entry.path))
			if (local.equals(upstream)) {
				adaptedReports.push(`adapted SAME (unexpected) ${entry.path}`)
			} else {
				adaptedReports.push(
					`adapted DIFF ${entry.path} (local ${local.length}b, upstream ${upstream.length}b): ${entry.reason}`,
				)
			}
		} catch (error) {
			adaptedReports.push(`adapted SKIP ${entry.path}: ${error.message}`)
		}
	}

	const next = {
		...manifest,
		kodyCommit: commit,
		updatedAt: new Date().toISOString(),
		files: updatedFiles,
	}
	await writeFile(manifestPath, serializeManifest(next))

	console.log(`\nCopied ${copied.length}, unchanged ${unchanged.length}:`)
	for (const p of copied) console.log(`  copy ${p}`)
	for (const p of unchanged) console.log(`  same ${p}`)
	if (adaptedReports.length > 0) {
		console.log('\nAdapted (not overwritten):')
		for (const line of adaptedReports) console.log(`  ${line}`)
	}
	console.log(`\nWrote ${path.relative(repoRoot, manifestPath)} @ ${commit}`)
}

/** Re-pin one verbatim file to `--commit`, leaving every other pin alone. */
async function updateOne(manifest, filePath) {
	if (!filePath || filePath.startsWith('--')) {
		throw new Error('--only needs a verbatim file path')
	}
	if (!commitOverride || !fullCommitShaPattern.test(commitOverride)) {
		throw new Error('--only needs --commit <full 40-character commit sha>')
	}
	const index = manifest.files.findIndex((entry) => entry.path === filePath)
	if (index < 0) {
		throw new Error(`--only ${filePath}: not a verbatim file in the manifest`)
	}
	const entry = manifest.files[index]
	const upstream = await fetchUpstream(commitOverride, entry.source)
	const localPath = path.join(repoRoot, entry.path)
	await mkdir(path.dirname(localPath), { recursive: true })
	await writeFile(localPath, upstream)
	const files = [...manifest.files]
	files[index] = { ...entry, sha256: sha256(upstream), kodyCommit: commitOverride }
	await writeFile(manifestPath, serializeManifest({ ...manifest, updatedAt: new Date().toISOString(), files }))
	console.log(`Pinned ${entry.path} to ${kodyRepo}@${commitOverride}`)
}

async function main() {
	const manifest = await readManifest()
	if (checkOnly) {
		await check(manifest)
		return
	}
	if (onlyFlag >= 0) {
		await updateOne(manifest, onlyPath)
		return
	}
	await update(manifest)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
