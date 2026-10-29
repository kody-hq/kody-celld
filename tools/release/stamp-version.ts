// Writes src/version.ts for an image build. The release tag is the only
// source of truth for the version: the Dockerfile passes the tag's version
// (or `git describe` on main) as the KODY_CELLD_VERSION build arg, and the
// committed src/version.ts keeps the `0.0.0-dev` placeholder.
import { writeFileSync } from 'node:fs'
import { isExecutedDirectly } from '../node-runtime.ts'

export const devVersion = '0.0.0-dev'

const buildVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/

export function versionModuleSource(version: string): string {
	if (!buildVersion.test(version)) {
		throw new Error(`Invalid KODY_CELLD_VERSION "${version}" (expected X.Y.Z with optional -suffix).`)
	}
	return [
		'// The release tag is the source of truth. Image builds overwrite this file',
		'// with the tag version (tools/release/stamp-version.ts); source checkouts',
		'// report the placeholder. See docs/contributing/releases.md.',
		`export const KODY_CELLD_VERSION = '${version}'`,
		'',
	].join('\n')
}

if (isExecutedDirectly(import.meta.url)) {
	const version = process.argv[2] || devVersion
	writeFileSync(new URL('../../src/version.ts', import.meta.url), versionModuleSource(version))
	console.log(`src/version.ts -> ${version}`)
}
