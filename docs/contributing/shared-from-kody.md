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

## UI sync boundaries

All UI lives in `start/`, matching hosted's TanStack Start, React-compatible
Redact and Emotion layout. Legacy Remix renderers, islands and registrations
are removed.

The manifest pins hosted primitives verbatim, including icons, branding,
clipboard/code-copy buttons, toast, avatar, YouTube embeds, heading anchors
and the Emotion style-hoist helper. Promote matching contracts to verbatim
instead of retaining renderer-translation copies.

Pages, native forms, self-hosted navigation and package exploration remain
adapted where Worker data or security contracts differ. Markdown retains
celld's safe Marked lexer policy and serialized Shiki spans rather than
substituting hosted's package/install and highlight models. Adapted UI also
uses React/Emotion; there is no second renderer.

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
