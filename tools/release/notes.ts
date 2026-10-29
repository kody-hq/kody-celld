// Pure release-note helpers for the daily release workflow
// (.github/workflows/release.yml). plan.ts gathers git and GitHub data and
// calls buildReleaseNotes; nothing here touches the network.

export type ReleaseBump = 'patch' | 'minor' | 'major'

export type ReleasePullRequest = {
	number: number
	title: string
	body: string | null
	author: string
	authorType: string
	authorAssociation: string
}

export type ReleaseCommit = {
	sha: string
	subject: string
	pullRequest: ReleasePullRequest | null
}

export type ReleaseNotesInput = {
	repo: string
	version: string
	previousTag: string
	commits: Array<ReleaseCommit>
	image?: string
}

const semverTag = /^v(\d+)\.(\d+)\.(\d+)$/
const maintainerAssociations = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const conventional = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?:\s*/i

export function isReleaseTag(tag: string): boolean {
	return semverTag.test(tag)
}

export function versionFromTag(tag: string): string {
	const match = semverTag.exec(tag)
	if (!match) throw new Error(`Not a release tag: "${tag}" (expected vX.Y.Z).`)
	return `${match[1]}.${match[2]}.${match[3]}`
}

export function bumpVersion(version: string, bump: ReleaseBump): string {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
	if (!match) throw new Error(`Invalid version "${version}".`)
	const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
	if (bump === 'major') return `${major + 1}.0.0`
	if (bump === 'minor') return `${major}.${minor + 1}.0`
	if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
	throw new Error(`Invalid bump "${String(bump)}" (expected patch, minor, or major).`)
}

/** PR number from a squash-merge subject such as `fix(oauth): ... (#138)`. */
export function pullRequestNumberFromSubject(subject: string): number | null {
	const match = /\(#(\d+)\)\s*$/.exec(subject.trim())
	return match ? Number(match[1]) : null
}

/** Release bump commits from the old manual process never appear in notes. */
export function isReleaseCommit(subject: string): boolean {
	return /^chore\(release\)/i.test(subject.trim())
}

/** Authors outside the org who are not bots get thanked by @handle. */
export function isOutsideContributor(pr: ReleasePullRequest): boolean {
	if (pr.authorType === 'Bot' || /\[bot\]$/i.test(pr.author)) return false
	return !maintainerAssociations.has(pr.authorAssociation)
}

/** Release notes and docs in this repo do not use em or en dashes. */
export function withoutLongDashes(text: string): string {
	return text.replace(/\s*[\u2014\u2013]\s*/g, (match) => (match.trim() === match ? '-' : ' - '))
}

export function displayTitle(title: string): string {
	const stripped = title
		.trim()
		.replace(conventional, '')
		.replace(/\s*\(#\d+\)\s*$/, '')
		.trim()
	const text = stripped.length > 0 ? stripped : title.trim()
	return withoutLongDashes(text.charAt(0).toUpperCase() + text.slice(1))
}

export type ChangeKind = 'features' | 'fixes' | 'other'

export function changeKind(title: string): ChangeKind {
	const type = conventional.exec(title.trim())?.groups?.type?.toLowerCase()
	if (type === 'feat') return 'features'
	if (type === 'fix' || type === 'perf' || type === 'revert') return 'fixes'
	return 'other'
}

/**
 * The optional `## Release notes` section of a PR body (any heading level),
 * minus HTML comments. Returns null when it is missing or left empty.
 */
export function releaseNotesFromBody(body: string | null): string | null {
	if (!body) return null
	const lines = body
		.replace(/\r\n/g, '\n')
		.replace(/<!--[\s\S]*?-->/g, '')
		.split('\n')
	const start = lines.findIndex((line) => /^#{1,6}\s+release notes\s*:?\s*$/i.test(line.trim()))
	if (start === -1) return null
	const level = /^(#+)/.exec(lines[start]!.trim())![1]!.length
	const section: Array<string> = []
	for (const line of lines.slice(start + 1)) {
		const heading = /^(#+)\s/.exec(line.trim())
		if (heading && heading[1]!.length <= level) break
		section.push(line)
	}
	const text = section.join('\n').trim()
	if (!text || /^(none|n\/a|-)\.?$/i.test(text)) return null
	return withoutLongDashes(text)
}

function joinHandles(handles: Array<string>): string {
	const at = handles.map((handle) => `@${handle}`)
	if (at.length <= 1) return at.join('')
	if (at.length === 2) return `${at[0]} and ${at[1]}`
	return `${at.slice(0, -1).join(', ')}, and ${at.at(-1)}`
}

type Entry = { kind: ChangeKind; line: string; sortKey: number }

export function buildReleaseNotes(input: ReleaseNotesInput): { title: string; body: string } {
	const tag = `v${input.version}`
	const image = input.image ?? `ghcr.io/${input.repo}`
	const minor = input.version.split('.').slice(0, 2).join('.')
	const seenPullRequests = new Set<number>()
	const entries: Array<Entry> = []
	const contributors: Array<string> = []
	const upgradeNotes: Array<string> = []

	for (const commit of input.commits) {
		if (isReleaseCommit(commit.subject)) continue
		const pr = commit.pullRequest
		if (!pr) {
			entries.push({
				kind: changeKind(commit.subject),
				line: `- ${displayTitle(commit.subject)} (${commit.sha.slice(0, 7)})`,
				sortKey: Number.MAX_SAFE_INTEGER,
			})
			continue
		}
		if (seenPullRequests.has(pr.number) || isReleaseCommit(pr.title)) continue
		seenPullRequests.add(pr.number)
		const outside = isOutsideContributor(pr)
		if (outside && !contributors.includes(pr.author)) contributors.push(pr.author)
		const credit = outside ? `, thanks @${pr.author}` : ''
		entries.push({
			kind: changeKind(pr.title),
			line: `- ${displayTitle(pr.title)} (#${pr.number}${credit})`,
			sortKey: pr.number,
		})
		const notes = releaseNotesFromBody(pr.body)
		if (notes) upgradeNotes.push(`#### ${displayTitle(pr.title)} (#${pr.number})\n\n${notes}`)
	}

	const sections: Array<string> = []
	const changeCount = entries.length
	sections.push(`Daily release with ${changeCount} change${changeCount === 1 ? '' : 's'} since ${input.previousTag}.`)
	if (upgradeNotes.length > 0) sections.push(`### Release notes\n\n${upgradeNotes.join('\n\n')}`)
	const headings: Record<ChangeKind, string> = { features: 'Features', fixes: 'Fixes', other: 'Other changes' }
	for (const kind of ['features', 'fixes', 'other'] as const) {
		const lines = entries
			.filter((entry) => entry.kind === kind)
			.sort((a, b) => a.sortKey - b.sortKey)
			.map((entry) => entry.line)
		if (lines.length > 0) sections.push(`### ${headings[kind]}\n\n${lines.join('\n')}`)
	}
	if (contributors.length > 0) {
		sections.push(`### Thank you\n\nThanks to ${joinHandles(contributors)} for contributing to this release!`)
	}
	sections.push(
		[
			'### Upgrade',
			'',
			'1. Back up the data volume (`/data`).',
			`2. Set the image to \`${image}:${input.version}\` (or \`:${minor}\`), then \`docker compose pull && docker compose up -d\`.`,
			`3. Check that \`/health\` reports \`"version":"${input.version}"\`.`,
			'',
			`**Full changelog:** https://github.com/${input.repo}/compare/${input.previousTag}...${tag}`,
		].join('\n'),
	)
	return { title: tag, body: `${sections.join('\n\n')}\n` }
}
