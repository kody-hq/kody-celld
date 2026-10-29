import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	buildReleaseNotes,
	bumpVersion,
	changeKind,
	displayTitle,
	isOutsideContributor,
	pullRequestNumberFromSubject,
	releaseNotesFromBody,
	versionFromTag,
	type ReleasePullRequest,
} from './notes.ts'
import { versionModuleSource } from './stamp-version.ts'

function pr(overrides: Partial<ReleasePullRequest> & { number: number; title: string }): ReleasePullRequest {
	return { body: null, author: 'kentcdodds', authorType: 'User', authorAssociation: 'OWNER', ...overrides }
}

test('versions come from vX.Y.Z tags and bump by patch by default', () => {
	assert.equal(versionFromTag('v0.2.4'), '0.2.4')
	assert.throws(() => versionFromTag('cli-v1.0.0'))
	assert.equal(bumpVersion('0.2.4', 'patch'), '0.2.5')
	assert.equal(bumpVersion('0.2.4', 'minor'), '0.3.0')
	assert.equal(bumpVersion('0.2.4', 'major'), '1.0.0')
})

test('squash subjects map to PR numbers, kinds, and clean titles', () => {
	assert.equal(pullRequestNumberFromSubject('fix(oauth): allow redirect (#138)'), 138)
	assert.equal(pullRequestNumberFromSubject('fix: no number'), null)
	assert.equal(changeKind('feat(api)!: add /v1'), 'features')
	assert.equal(changeKind('fix: thing'), 'fixes')
	assert.equal(changeKind('docs: thing'), 'other')
	assert.equal(displayTitle('fix(oauth): allow the redirect \u2014 really (#138)'), 'Allow the redirect - really')
})

test('only non-bot authors outside the org are outside contributors', () => {
	assert.equal(isOutsideContributor(pr({ number: 1, title: 'x', authorAssociation: 'CONTRIBUTOR' })), true)
	assert.equal(isOutsideContributor(pr({ number: 1, title: 'x', authorAssociation: 'FIRST_TIME_CONTRIBUTOR' })), true)
	assert.equal(isOutsideContributor(pr({ number: 1, title: 'x', authorAssociation: 'MEMBER' })), false)
	assert.equal(
		isOutsideContributor(
			pr({ number: 1, title: 'x', author: 'dependabot[bot]', authorType: 'Bot', authorAssociation: 'NONE' }),
		),
		false,
	)
})

test('the optional Release notes PR section is extracted without comments', () => {
	const body =
		'## Summary\n\nstuff\n\n## Release notes\n\n<!-- hint -->\nSet `KODY_X` before upgrading.\n\n## Testing\n\nran it'
	assert.equal(releaseNotesFromBody(body), 'Set `KODY_X` before upgrading.')
	assert.equal(releaseNotesFromBody('## Release notes\n\n<!-- only a hint -->\n\n## Testing'), null)
	assert.equal(releaseNotesFromBody('## Release notes\n\nNone\n'), null)
	assert.equal(releaseNotesFromBody(null), null)
})

test('release notes group changes, credit outside contributors, and skip release commits', () => {
	const { title, body } = buildReleaseNotes({
		repo: 'kody-hq/kody-celld',
		version: '0.2.5',
		previousTag: 'v0.2.4',
		commits: [
			{
				sha: 'a'.repeat(40),
				subject: 'chore(release): 0.2.4 (#139)',
				pullRequest: pr({ number: 139, title: 'chore(release): 0.2.4' }),
			},
			{
				sha: 'b'.repeat(40),
				subject: 'fix(oauth): allow redirect (#138)',
				pullRequest: pr({
					number: 138,
					title: 'fix(oauth): allow redirect',
					author: 'Averus89',
					authorAssociation: 'CONTRIBUTOR',
				}),
			},
			{
				sha: 'c'.repeat(40),
				subject: 'feat: add thing (#140)',
				pullRequest: pr({
					number: 140,
					title: 'feat: add thing',
					body: '## Release notes\n\nRestart after upgrading.',
				}),
			},
			{ sha: 'd'.repeat(40), subject: 'docs: direct commit', pullRequest: null },
		],
	})
	assert.equal(title, 'v0.2.5')
	assert.match(body, /^Daily release with 3 changes since v0\.2\.4\./)
	assert.doesNotMatch(body, /#139/)
	assert.match(body, /### Features\n\n- Add thing \(#140\)/)
	assert.match(body, /### Fixes\n\n- Allow redirect \(#138, thanks @Averus89\)/)
	assert.match(body, /### Other changes\n\n- Direct commit \(ddddddd\)/)
	assert.match(body, /#### Add thing \(#140\)\n\nRestart after upgrading\./)
	assert.match(body, /Thanks to @Averus89 for contributing to this release!/)
	assert.match(body, /ghcr\.io\/kody-hq\/kody-celld:0\.2\.5/)
	assert.match(body, /compare\/v0\.2\.4\.\.\.v0\.2\.5/)
	assert.doesNotMatch(body, /[\u2014\u2013]/)
})

test('the version module only accepts semver build versions', () => {
	assert.match(versionModuleSource('0.2.5'), /KODY_CELLD_VERSION = '0\.2\.5'/)
	assert.match(versionModuleSource('0.2.4-3-gabc1234'), /'0\.2\.4-3-gabc1234'/)
	assert.throws(() => versionModuleSource("0.2.5'; evil"))
	assert.throws(() => versionModuleSource(''))
})
