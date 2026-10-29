# Releases

kody-celld cuts a patch release every day there is something new on `main`.
Nobody bumps a version by hand.

## How it works

[`release.yml`](../../.github/workflows/release.yml) runs daily at 11:17 UTC
and on demand (Actions, **Release**, **Run workflow**). It mirrors hosted
Kody's nightly release: a quiet day is a no-op, notes come from the merged
PRs, and creating the release is idempotent.

1. **Plan** ([`tools/release/plan.ts`](../../tools/release/plan.ts)). Find the
   newest `vX.Y.Z` tag reachable from `main`. If `main` has no commits since
   it, stop: nothing is tagged or published. Otherwise the next version is
   that tag plus one patch (`minor` or `major` only when picked on a manual
   run).
2. **Notes** ([`tools/release/notes.ts`](../../tools/release/notes.ts)). One
   line per merged PR since the last released tag, grouped into Features,
   Fixes, and Other changes by the PR title's conventional-commit type. Any
   `## Release notes` section in a PR body is copied in as an upgrade note.
   Authors outside the `kody-hq` org are credited by their GitHub `@handle`
   and thanked. Bots and `chore(release)` PRs are left out.
3. **Release.** Create the GitHub Release, which creates the tag on the
   planned `main` commit. A rerun skips this step when the release exists.
4. **Image.** Call [`publish.yml`](../../.github/workflows/publish.yml) with
   the tag. It pushes `ghcr.io/kody-hq/kody-celld:X.Y.Z`, `:X.Y`, and
   `:latest` for amd64 and arm64, then pulls the image anonymously,
   smoke-tests it, and checks that `/health` reports `X.Y.Z`. The call is
   direct because a tag created with `GITHUB_TOKEN` does not fire the
   workflow's own tag trigger.

The workflow only uses `GITHUB_TOKEN`. It never pushes to `main`, so the
required CLA check and branch rules stay as they are.

## The tag is the version

There is no bump commit. `src/version.ts` holds the `0.0.0-dev` placeholder,
and `package.json` says `0.0.0-dev` too. When `publish.yml` builds an image it
passes the version as the `KODY_CELLD_VERSION` build arg, and the Dockerfile
runs [`tools/release/stamp-version.ts`](../../tools/release/stamp-version.ts)
to write it into `src/version.ts` before the bundle builds:

| Image               | `/health` `version` |
| ------------------- | ------------------- |
| tag `v1.2.3`        | `1.2.3`             |
| `main` push         | `1.2.3-4-gabc1234`  |
| local `npm run dev` | `0.0.0-dev`         |

## Writing upgrade notes

Release notes need no extra work: a clear, conventional PR title
(`fix(oauth): ...`) becomes the line. When an upgrade needs a self-hoster to
act (a new `KODY_` variable, a migration, a removed route), fill in the
`## Release notes` section of the
[pull request template](../../.github/pull_request_template.md). Release notes
use public GitHub handles only, never production user names, and no em
dashes.

## Running it by hand

- **Dry run** (the default for manual runs): plans the release and prints the
  notes in the run summary without tagging, releasing, or publishing.
- **Real run:** untick `dry_run`. Pick `minor` or `major` for a bigger bump.
- **Rerun after a failure:** rerun the failed jobs. Creating the release is
  skipped once it exists, so a failed image publish can simply be retried.
- **Local preview:** `GH_TOKEN=$(gh auth token) node tools/release/plan.ts`
  prints the next version and notes. It only reads.

Older releases (v0.2.4 and earlier) were cut by hand; their notes are in
[CHANGELOG.md](../../CHANGELOG.md).
