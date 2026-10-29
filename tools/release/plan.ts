// Plans the next release for .github/workflows/release.yml (and local dry
// runs). Read-only: it reads git history and the GitHub API, writes the
// notes file, and prints the plan. It never creates tags or releases.
//
//   GH_TOKEN=... node tools/release/plan.ts [--bump patch|minor|major]
//     [--head <sha>] [--repo owner/name] [--notes-file path]
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { isExecutedDirectly } from '../node-runtime.ts'
import {
	buildReleaseNotes,
	bumpVersion,
	isReleaseTag,
	pullRequestNumberFromSubject,
	versionFromTag,
	type ReleaseBump,
	type ReleaseCommit,
	type ReleasePullRequest,
} from './notes.ts'

const require = createRequire(import.meta.url)
const { withGithubApiRetry } = require('../ci/github-api-retry.cjs') as {
	withGithubApiRetry: <T>(run: () => Promise<T>) => Promise<T>
}

export type ReleasePlan =
	| { release: false; reason: string; latestTag: string }
	| {
			release: true
			version: string
			tag: string
			latestTag: string
			previousTag: string
			head: string
			title: string
			notes: string
	  }

function git(args: Array<string>): string {
	return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

/** Release tags reachable from head, newest version first. */
export function releaseTagsMergedInto(head: string): Array<string> {
	return git(['tag', '--merged', head, '--list', 'v*', '--sort=-v:refname'])
		.split('\n')
		.map((tag) => tag.trim())
		.filter(isReleaseTag)
}

function tagExists(tag: string): boolean {
	return git(['tag', '--list', tag]) === tag
}

function commitsBetween(from: string, head: string): Array<{ sha: string; subject: string }> {
	const raw = git(['log', '--reverse', '--format=%H%x1f%s', `${from}..${head}`])
	if (!raw) return []
	return raw.split('\n').map((line) => {
		const [sha = '', subject = ''] = line.split('\x1f')
		return { sha, subject }
	})
}

type GithubPull = {
	number: number
	title: string
	body: string | null
	merged_at: string | null
	merge_commit_sha: string | null
	author_association: string
	user: { login: string; type: string } | null
}

class GithubClient {
	readonly repo: string
	readonly token: string

	constructor(repo: string, token: string) {
		this.repo = repo
		this.token = token
	}

	async get<T>(path: string): Promise<{ status: number; data: T | null }> {
		return withGithubApiRetry(async () => {
			const response = await fetch(`https://api.github.com/repos/${this.repo}${path}`, {
				headers: {
					accept: 'application/vnd.github+json',
					authorization: `Bearer ${this.token}`,
					'x-github-api-version': '2022-11-28',
					'user-agent': 'kody-celld-release',
				},
			})
			if (response.status === 404) return { status: 404, data: null }
			if (!response.ok) {
				const error = new Error(`GitHub GET ${path} failed with ${response.status}`) as Error & { status: number }
				error.status = response.status
				throw error
			}
			return { status: response.status, data: (await response.json()) as T }
		})
	}

	async hasPublishedRelease(tag: string): Promise<boolean> {
		const { data } = await this.get<{ draft: boolean }>(`/releases/tags/${encodeURIComponent(tag)}`)
		return data !== null && !data.draft
	}

	async pullRequestFor(sha: string, subject: string): Promise<ReleasePullRequest | null> {
		const { data } = await this.get<Array<GithubPull>>(`/commits/${sha}/pulls`)
		let pull = (data ?? []).find((pr) => pr.merge_commit_sha === sha) ?? (data ?? []).find((pr) => pr.merged_at)
		const fromSubject = pullRequestNumberFromSubject(subject)
		if (!pull && fromSubject !== null) {
			pull = (await this.get<GithubPull>(`/pulls/${fromSubject}`)).data ?? undefined
		}
		if (!pull) return null
		return {
			number: pull.number,
			title: pull.title,
			body: pull.body,
			author: pull.user?.login ?? 'ghost',
			authorType: pull.user?.type ?? 'User',
			authorAssociation: pull.author_association,
		}
	}
}

export async function planRelease(options: {
	repo: string
	token: string
	head: string
	bump: ReleaseBump
}): Promise<ReleasePlan> {
	const head = git(['rev-parse', `${options.head}^{commit}`])
	const tags = releaseTagsMergedInto(head)
	const latestTag = tags[0]
	if (!latestTag) throw new Error(`No vX.Y.Z tag is reachable from ${head}; tag the first release by hand.`)
	if (commitsBetween(latestTag, head).length === 0) {
		return { release: false, reason: `No new commits on main since ${latestTag}.`, latestTag }
	}

	const github = new GithubClient(options.repo, options.token)
	// Notes start at the newest tag that has a published GitHub release, so a
	// tag left behind by a failed run does not drop its commits from the notes.
	let previousTag = latestTag
	for (const tag of tags.slice(0, 10)) {
		if (await github.hasPublishedRelease(tag)) {
			previousTag = tag
			break
		}
		console.warn(`::warning::${tag} has no published GitHub release; its commits go into this release.`)
	}

	const version = bumpVersion(versionFromTag(latestTag), options.bump)
	const tag = `v${version}`
	if (tagExists(tag)) throw new Error(`${tag} already exists but is not reachable from ${head}.`)

	const commits: Array<ReleaseCommit> = []
	for (const commit of commitsBetween(previousTag, head)) {
		commits.push({ ...commit, pullRequest: await github.pullRequestFor(commit.sha, commit.subject) })
	}
	const notes = buildReleaseNotes({ repo: options.repo, version, previousTag, commits })
	return { release: true, version, tag, latestTag, previousTag, head, title: notes.title, notes: notes.body }
}

function writeOutputs(plan: ReleasePlan, notesFile: string) {
	const outputs: Record<string, string> = { release: String(plan.release), latest_tag: plan.latestTag }
	if (plan.release) {
		Object.assign(outputs, {
			version: plan.version,
			tag: plan.tag,
			previous_tag: plan.previousTag,
			head: plan.head,
			title: plan.title,
			notes_file: notesFile,
		})
	}
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			Object.entries(outputs)
				.map(([key, value]) => `${key}=${value}\n`)
				.join(''),
		)
	}
	if (process.env.GITHUB_STEP_SUMMARY) {
		const summary = plan.release
			? `## Release plan: ${plan.tag}\n\nFrom ${plan.previousTag} to \`${plan.head.slice(0, 7)}\`.\n\n${plan.notes}`
			: `## Release plan: nothing to release\n\n${plan.reason}\n`
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
	}
}

if (isExecutedDirectly(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			bump: { type: 'string', default: 'patch' },
			head: { type: 'string', default: process.env.GITHUB_SHA || 'HEAD' },
			repo: { type: 'string', default: process.env.GITHUB_REPOSITORY || 'kody-hq/kody-celld' },
			'notes-file': { type: 'string', default: 'release-notes.md' },
		},
	})
	const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
	if (!token) throw new Error('Set GH_TOKEN or GITHUB_TOKEN to read pull requests and releases.')
	const bump = values.bump as ReleaseBump
	if (!['patch', 'minor', 'major'].includes(bump)) throw new Error(`Invalid --bump "${bump}".`)
	const plan = await planRelease({ repo: values.repo, token, head: values.head, bump })
	const notesFile = values['notes-file']
	if (plan.release) {
		writeFileSync(notesFile, plan.notes)
		console.log(`Next release: ${plan.tag} (notes since ${plan.previousTag}, head ${plan.head}).\n`)
		console.log(plan.notes)
	} else {
		console.log(plan.reason)
	}
	writeOutputs(plan, notesFile)
}
