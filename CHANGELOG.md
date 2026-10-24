# Changelog

Release notes for **kody-celld**. Tagged GitHub Releases remain the published
source; this file holds the draft for the next tag and a short index of past
ones.

## [Unreleased]

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
way (`:0.2.0`, `:0.2`, …) once that tag exists under `kody-hq`.

### Email: open a message and read it

Rows on **Account → Email** now open the message under its row
(`/account/inbox/:messageId`) with From, To, Date, Subject, CC, Reply-To,
attachments, and the full body as HTML, Text, or HTML Source, matching hosted
Kody. HTML renders the way hosted does: scripts stripped, then a sandboxed
`srcdoc` iframe with no scripts, forms, popups, or same-origin access.

## Past releases

- [v0.2.0](https://github.com/kody-hq/kody-celld/releases/tag/v0.2.0) — external MCP servers, package apps, one private-host allowlist
- [v0.1.1](https://github.com/kody-hq/kody-celld/releases/tag/v0.1.1) — keep dev email defaults out of single-node Docker
- [v0.1.0](https://github.com/kody-hq/kody-celld/releases/tag/v0.1.0) — first public self-hosted release
