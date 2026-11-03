# Shared-from-kody sync lock

kody-celld copies selected files from
[kody-hq/kody](https://github.com/kody-hq/kody) and pins them in
[`shared-from-kody.json`](../../shared-from-kody.json). CI fails when a pinned
file drifts from the upstream bytes at the pinned commit.

## Commands

```sh
npm run sync:kody          # update pins from kody main, copy verbatim files, report adapted diffs
npm run sync:kody -- --commit <sha>
npm run sync:kody:check    # verify every pinned file matches upstream (also run in CI)
```

## Verbatim vs adapted

- **Verbatim** (`files`): must match upstream byte-for-byte. Do not hand-edit.
  Change them in hosted Kody, then run `npm run sync:kody`.
- **Adapted** (`adapted`): share a path with hosted Kody but differ on purpose.
  The sync script reports diffs and never overwrites them. To promote an
  adapted file to verbatim, make celld match hosted (or document why it cannot)
  and move the entry.

## Resync vs delist (Oct 10, 2026)

Of the 36 non-route `client/` + `universal/` files that share a path with
hosted Kody, 17 differed from kody main. Choices:

| File                                   | Choice | Why                                           |
| -------------------------------------- | ------ | --------------------------------------------- |
| `client/copy-code-block.tsx`           | resync | Styling drift only; prefer hosted             |
| `client/double-check.ts`               | resync | Missing hosted `arm()` helper                 |
| `universal/package-file-media.ts`      | resync | Formatting-only drift                         |
| `universal/styles/style-primitives.ts` | resync | Missing hosted YouTube poster rule            |
| `universal/icon-glyphs.tsx`            | resync | Missing hosted glyphs (`plus`, `git-fork`, …) |
| `client/app-root.tsx`                  | delist | Different shell / route dispatch              |
| `client/client-router.tsx`             | delist | Hosted full router vs celld helper            |
| `client/copy-text-button.tsx`          | delist | `clientEntry` island wrap                     |
| `client/entry.tsx`                     | delist | Island registry / Navigation API stop         |
| `client/package-files-explorer.tsx`    | delist | `embedded` prop for package detail            |
| `client/site-footer.tsx`               | delist | Self-hosted nav and version                   |
| `client/site-header.tsx`               | delist | Account/console nav, no org chrome            |
| `client/toaster.tsx`                   | delist | `clientEntry` island wrap                     |
| `universal/loader-data.ts`             | delist | celld `AppLoaderData` shapes                  |
| `universal/package-files.ts`           | delist | Community/public href helpers not ported      |
| `universal/package-readme-images.ts`   | delist | No `/assets/` route                           |
| `universal/routes.ts`                  | delist | celld route table only                        |

`public/styles.css` is adapted (self-hosted CSS subset). Principle pages under
`docs/principles/` (except the celld-owned index and celld-only pages) are
verbatim.

## Hosted moved to React (Nov 3, 2026)

The full re-pin to kody-hq/kody@e3149c45 found that hosted Kody replaced its
Remix 3 web UI with React + TanStack Start. Components moved to
`packages/worker/start/components/` and are React + Emotion; markdown parses
with `@tanstack/markdown`; code highlighting uses TanStack highlight. celld
stays on Remix 3, so:

- **Adapted** (hosted rewrote them for React, Emotion, `@tanstack/markdown` or
  TanStack highlight): `client/copy-code-block.tsx`,
  `client/doc-youtube-embed.tsx`, `client/markdown-first-party.ts`,
  `client/markdown-heading-anchor.tsx`, `client/markdown-view.tsx`,
  `client/syntax-highlight.tsx`, `client/youtube-light-player.tsx`,
  `universal/highlighted-code.ts`, `universal/icon-glyphs.tsx`,
  `universal/icon.tsx`, `universal/styles/style-primitives.ts`,
  `universal/user-avatar.tsx`.
- **Delisted** (deleted upstream): `client/double-check.ts`,
  `client/event-mixin.ts`, `client/app-root.tsx`, `client/client-router.tsx`,
  `client/entry.tsx`. They are celld-owned now.
- **Still verbatim**: framework-neutral helpers, tokens, fonts, principles and
  `src/lib` shared modules.

Every verbatim file pins to the one top-level `kodyCommit`; there is no
per-file pin.

## Interim contract modules (second lane)

These three adapted copies are an interim second lane, not the end state:

- `src/jobs/schedule.ts`
- `src/secrets/placeholders.ts`
- `src/packages/manifest.ts`

Replace them with a shared `@kody/core` package, then delete the interim copies
and every doc about them. Tracked in
[#69](https://github.com/kody-hq/kody-celld/issues/69).

## Related

- [Match hosted first](../principles/match-hosted-first.md)
- [Keep agent context lean](../principles/lean-agent-context.md)
- [#69 Replace interim contract modules with @kody/core](https://github.com/kody-hq/kody-celld/issues/69)
