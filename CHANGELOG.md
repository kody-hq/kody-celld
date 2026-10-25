# Changelog

Release notes for **kody-celld**. Tagged GitHub Releases remain the published
source; this file holds the draft for the next tag, the notes for the latest
tag, and a short index of past ones.

## [Unreleased]

## [0.2.2] - 2026-10-25

### Email HTML preview links

Links in a message's HTML body open in a normal new tab, with no opener and no
referrer. The preview iframe allows popups (and lets them escape the sandbox)
but still blocks scripts, forms, and same-origin access. Link normalization is
hardened against comment and RAWTEXT bypasses so crafted markup cannot keep an
opener-granting `rel` on a real link.

## [0.2.1] - 2026-10-23

### Upgrade notes

- **LAN hosts reached by a public DNS name** now need `KODY_PRIVATE_HOSTS`
  (see "Package sources and browser rendering resolve hostnames" below).
- **https installs sign everyone out once.** Kody's cookies are now
  `__Host-kody_session` and `__Host-kody_console`, and the old names are not
  read. Plain-http installs keep the unprefixed names.
- **Single-node Docker now garbage-collects superseded LTX epochs** after one
  day by default (`CELLD_LTX_RETENTION_SECS=86400`). Set
  `CELLD_LTX_RETENTION_SECS=0` to keep the previous no-deletion behavior.
- **Image path moved** to `ghcr.io/kody-hq/kody-celld` (see below).

### Package sources and browser rendering resolve hostnames

Package installs and previews (every hop, including redirects) and browser
rendering `url`s now resolve the hostname through `KODY_DNS_RESOLVER_URL`,
like MCP servers already did, and refuse private answers that
`KODY_PRIVATE_HOSTS` does not allow. If you install packages from, or render
pages on, a LAN host by a public DNS name, list its address range in
`KODY_PRIVATE_HOSTS` (or the name itself). See [docs/browser.md](./docs/browser.md)
for what the browser check cannot cover.

### Image registry path (self-hosters)

Images now publish to `ghcr.io/kody-hq/kody-celld` (Publish workflow uses
`ghcr.io/${{ github.repository }}` after the repo moved to `kody-hq`).

`ghcr.io/kentcdodds/kody-celld` **no longer receives updates**. Existing tags
there are left in place so current pulls keep working, but `:latest` and new
version tags only appear under `kody-hq`.

**One-line change** in your Compose (or equivalent) `image:` field:

```diff
-    image: ghcr.io/kentcdodds/kody-celld:latest
+    image: ghcr.io/kody-hq/kody-celld:latest
```

Then `docker compose pull && docker compose up -d`. Pin a version tag the same
way (`:0.2.1`, `:0.2`, …).

### Email: open a message and read it

Rows on **Account → Email** now open the message under its row
(`/account/inbox/:messageId`) with From, To, Date, Subject, CC, Reply-To,
attachments, and the full body as HTML, Text, or HTML Source, matching hosted
Kody. HTML renders the way hosted does: scripts stripped, then a sandboxed
`srcdoc` iframe with no scripts, forms, popups, or same-origin access.

### Other fixes

- **Cookies:** https installs use `__Host-` cookie names so sibling
  package-app hosts cannot plant or shadow them, and startup warns once when
  `KODY_PUBLIC_URL` and `KODY_APP_BASE_URL` share a registrable domain (#81).
- **Docker single mode:** after deploy, the node runs directly instead of
  under `celld.dev`, so large installs no longer crash-loop on the 30s
  announce deadline (#90), and superseded LTX epochs are now garbage-collected
  (#93).
- **Secrets:** the fetch gateway keeps the original request body bytes unless
  the body holds a resolved placeholder, so binary uploads with a header-only
  secret arrive intact (#96).
- **Branding:** the current Kody mark, edge-to-edge favicons, a `/brand-guide`
  page with download assets, and a header mark context menu (#102).
- **CI:** Publish fails if the pushed image cannot be pulled anonymously
  (#94), and fork pull requests get CLA signing instructions (#98).

## Past releases

- [v0.2.2](https://github.com/kody-hq/kody-celld/releases/tag/v0.2.2): email preview links open in a new tab; link normalization hardened against comment and RAWTEXT bypasses
- [v0.2.1](https://github.com/kody-hq/kody-celld/releases/tag/v0.2.1): resolve hostnames for package sources and browser URLs, Email message view, single-mode Docker fixes
- [v0.2.0](https://github.com/kody-hq/kody-celld/releases/tag/v0.2.0) — external MCP servers, package apps, one private-host allowlist
- [v0.1.1](https://github.com/kody-hq/kody-celld/releases/tag/v0.1.1) — keep dev email defaults out of single-node Docker
- [v0.1.0](https://github.com/kody-hq/kody-celld/releases/tag/v0.1.0) — first public self-hosted release
