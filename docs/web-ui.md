# Web UI: sign-in, account, operator console

All web documents use hosted Kody's TanStack Start, TanStack Router,
React-compatible `@tanstack/redact`, Emotion and first-party primitives.
Redact is hosted's build-time renderer replacement; no Preact substitution
is used. Pages/components live in `start/`; framework-neutral helpers stay
in `client/` and `universal/`.

Worker handlers retain method dispatch, authentication, owner isolation,
CSRF, OAuth, auditing and storage. Every page uses native anchors and HTML
forms, including with JavaScript disabled. Hydration adds clipboard controls,
file filtering, directory toggles, menus, toasts, pending labels and progressive
confirmation; no form handling moves into client code. Without JavaScript,
confirmation remains an enhancement, not a mutation gate.
Server timestamp locale/time zone are serialized for matching hydration.
Operator-console and browser-session cookies remain separate.

Start credential receipts and account secret-entry forms install a blocking lifecycle
guard before the body is parsed. It clears marked sensitive fields and hides
the document on departure, then replaces a back/forward-cache restoration with
a fresh GET, rechecking authentication without replaying the credential POST.
Other ordinary GET pages do not load the guard.
Protected account and secret-setup requests also expire a browser-session cookie that the
registry rejects. Requests without that cookie cannot clear it, and the
operator-console cookie is left alone. Cookie changes let
[Chrome](https://developer.chrome.com/docs/web-platform/bfcache-ccns) evict stale
`no-store` history entries even when page scripts are disabled; valid session
lifetimes and authentication policy are unchanged.
All account pages share the same account-navigation data.
Request-scoped CSP nonces also preserve the
consent page's validated redirect `form-action` source. The MCP surface is
unchanged — the UI is a convenience layer over the same cells and
capabilities.

| Route                 | Who              | What                                                                            |
| --------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `/`                   | anyone (browser) | redirects to `/account` (signed in) or `/signin`; API clients still get JSON    |
| `/brand-guide`        | anyone           | logo / mark / app-icon downloads and usage rules (right-click the header mark)  |
| `/setup`              | first run only   | create the first account with the admin token + a password                      |
| `/signin`             | anyone           | password, one-time API token, or magic link (when outbound email is configured) |
| `/signin/link/:token` | anyone with link | invite / password reset (set a password) or magic sign-in (one click)           |
| `/signout`            | signed-in user   | `POST` — ends this browser session                                              |
| `/account/*`          | signed-in user   | the account pages below                                                         |
| `/oauth/authorize`    | signed-in user   | MCP client consent ([mcp-oauth.md](./mcp-oauth.md))                             |
| `/console/*`          | operator         | admin console, signed in with `KODY_ADMIN_TOKEN`                                |

## First run

With no users in the registry, `/signin` redirects to `/setup`. Enter the
admin token from your deployment (`KODY_ADMIN_TOKEN` in `.env`, or
`docker compose exec kody cat /data/kody.env`), your email, and a password
(12+ characters). That creates the first user and signs you in; `/setup` then
disappears for good. The old bootstrap (`POST /admin/users` + API token) keeps
working and is what the smoke tests use.

## Getting more people in

Accounts are created by the operator — there is no open registration:

- **Console → Users → Add a user** creates the account and shows a one-time
  **invite link** (valid 7 days). Hand it over out of band; the person opens
  it, sets a password, and is signed in. The same form can issue a **password
  reset** link for an existing account or a plain **API token**.
- **API**: `POST /admin/users/:id/invite` `{}` (or `{"reset":true}`) returns
  `{ url, expiresAt, kind }`.
- Links are single-use and are only consumed **after** the new password passes
  validation, so a typo does not burn the invite. Expired or reused links show
  a 410 page.

## Sign-in

- **Password**: PBKDF2-SHA256, 600k iterations, per-user salt; records below
  the current work factor are upgraded transparently on the next successful
  sign-in. Five wrong passwords lock the email for 15 minutes (`429`), even
  for the right password.
- **API token**: paste a `kc_…` token once to get a browser session; the
  token is not stored by the browser.
- **Magic link**: shown only when an outbound email adapter is configured
  ([email.md](./email.md)). The form answers identically whether or not the
  address has an account. Links are valid 15 minutes and single-use.
- **Sessions**: a random id, stored **hashed** in the registry, in an
  `HttpOnly; SameSite=Lax` cookie named `kody_session` on http or
  `__Host-kody_session` on https (`Secure`, Path=/, no Domain), 30 days.
  Upgrading an https install to `__Host-` signs everyone out once. Every
  state-changing form carries a session-bound CSRF token and must be a
  same-origin `POST` (cross-site `Origin` / `Sec-Fetch-Site` are refused).
  Sessions are listed and revocable at `/account/sessions`.
- `?next=` after sign-in only accepts same-origin paths (`/account/…`,
  `/oauth/authorize?…`); anything else falls back to `/account`.

## Account pages (`/account`)

| Page             | You can                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview         | see today's usage vs quotas, change your password                                                                                                                                                                                                                                                            |
| MCP clients      | see every OAuth client you authorized (name, scope, last use), revoke one or all                                                                                                                                                                                                                             |
| API tokens       | list (label, created, last used — never the value), create (value shown **once**), revoke                                                                                                                                                                                                                    |
| Secrets          | list names + approved hosts, add/replace a value (paste form; the value is never rendered again), delete                                                                                                                                                                                                     |
| Packages         | list saved packages with exports/jobs/webhooks/source; open details (`/account/packages/:name`, which opens on the files explorer at the package root, like kody) and files (`/account/packages/:name/files/*`); preview then install/fork; publish / unpublish; delete package                              |
| Jobs             | list schedules, last run, enable/disable; details and runs (`/account/jobs/:jobId`)                                                                                                                                                                                                                          |
| Workflows        | durable workflow runs: status, run time, attempts, last error; cancel a run that has not finished (`/account/workflows`)                                                                                                                                                                                     |
| Activity         | recent run history (status, duration, error names — never secret values); summary of open / ignored / resolved / running, an Open errors / Recent runs toggle, and Ignore / Resolve / Reopen on error runs; click a run to expand its full error, logs and result, with a copyable fix prompt for your agent |
| Webhooks         | every webhook your packages declare: handle, package, status, last delivery (never the URL)                                                                                                                                                                                                                  |
| Integrations     | connected OAuth integrations and their status, disconnect                                                                                                                                                                                                                                                    |
| Email            | email inboxes and recent messages; click a message to open it (`/account/inbox/:messageId`) with its headers, attachments and full body as HTML, Text or HTML Source                                                                                                                                         |
| Memories         | browse and search your memories, open one, soft-delete or delete permanently                                                                                                                                                                                                                                 |
| Browser sessions | list and revoke (this one or all others)                                                                                                                                                                                                                                                                     |

Email, Activity and MCP clients live at `/account/inbox`, `/account/runs` and `/account/clients`; the hosted product's paths for them (`/account/email`, `/account/activity`, `/account/mcp-oauth-clients`) redirect there.

Cloud Kody's account pages that are not here, on purpose:

- **Hosted-only, won't port:** Billing, Usage, Experiments. Overview already shows usage vs quotas.
- **Deferred:** Waiting (until kody-celld has several sources of attention items).
- **Same surface, different name:** Repositories is Packages here.
- **Different product:** cloud's MCP servers page manages servers Kody connects to; MCP clients here lists the OAuth clients authorized _to_ this server.
- **No separate page:** Connections. A "connect another agent" panel on MCP clients is planned.

Host approvals are intentionally **not** on the account pages — they stay an
operator decision (see [secrets.md](./secrets.md)); the Secrets page shows the
approved list and tells the user to ask.

## Operator console (`/console`)

Sign in with `KODY_ADMIN_TOKEN` (12-hour cookie, separate from user sessions;
`kody_console` with `Path=/console` on http, `__Host-kody_console` with
`Path=/` on https). Pages:

- **Users** — list with usage; add a user (returns an invite link); issue a
  reset link or an API token for a user; force a jobs dispatch.
- **User detail** (`/console/users/:id`) — approve / revoke secret hosts, view
  quotas (overrides stay on `PUT /admin/users/:id/quota`), sign the user out
  everywhere (browser sessions **and** OAuth grants).
- **Audit** (`/console/audit`) — the admin audit log, filterable by `actor`
  and `action` (`?actor=…&action=…&limit=…`).
- **Config** (`/console/config`) — version, public URL, and the effective AI /
  blob / browser / email adapter configuration (the same summaries
  `GET /admin/ai`, `/admin/blobs`, `/admin/browser`, `/admin/email` return;
  secret-bearing values are never included).

Everything the console does is also available on the JSON `/admin/*` API
([operations.md](./operations.md)), and every action is recorded in the audit
log with `via: 'console'`.

## How it is built

The layout mirrors hosted's `packages/worker/`:

| Path         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `start/`     | Start routes, React/Emotion pages, primitives, shell and entries  |
| `client/`    | Framework-neutral browser helpers, including email preview        |
| `universal/` | Shared routes, loader data, styles and package-file contracts     |
| `src/app/`   | Worker document bridge, headers, highlighting and file data       |
| `public/`    | First-party assets, lifecycle helpers and generated browser files |

1. The Worker authenticates, handles native forms and builds an `AppLoaderData`
   variant containing only data the page may show.
2. `renderStartDocument()` in `src/app/start-render.ts` provides request context
   and a CSP nonce to the bundled Start server, preserving status and headers.
   It waits for the first nonempty stream chunk before returning a response.
3. The root loader reads request context; the root shell retains icons, fonts,
   styles, skip link, noindex policy, flash, self-hosted navigation and version.
   Root error dispatch also handles errors at otherwise-valid page URLs.
4. Start hydrates the document. Forms remain native POSTs, not server functions;
   browser components perform no authentication, cell access or client fetching.

`vite.config.ts` uses hosted's `redact()`, `tanstackStart()` and Emotion JSX
pipeline. Routes remain at `/`, assets at `/build/start/`, and the bundled
server in `.start/server/`. Dependencies are bundled for celld instead of
using hosted's Cloudflare Vite deployment plugin. The generated route tree is
checked in for clean-checkout typechecking. Worker, shared-browser and Start
typechecks are separate; no renderer type stubs remain.

Bootstrap scripts carry the request nonce. The verbatim Emotion style-hoist
runs before hydration; every document has one doctype and no-store headers.
`npm test` builds the real Start bundle before renderer tests.
`npm run build:client` builds both Start environments in one Vite pipeline;
`build:start` is a compatibility alias. Dev, fleet and Docker use that pipeline.
The aggregate Remix dependency, SSR renderer, island registry and legacy
build lane are removed. Standalone `@remix-run/cookie` retains the exact codec
previously re-exported by `remix/cookie`; cookie format, signing and expiry
policy do not change. Package execution can still resolve author-selected
JSX runtimes independently of the web UI.

## Page layout

Every route renders exactly one page box inside `<main>`, and every page box
comes from `client/page-layout.ts`. That is what keeps the header brand, the
account rail, and the content column in the same place as you move between
pages.

| Width (`pageWidths`) | Max      | Used by                                                                 |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `app`                | 72rem    | header, footer, `AccountManagementShell` (account + console), community |
| `article`            | 46rem    | one thing to read: a community package, a package miss                  |
| `message`            | 48rem    | illustrated 404 / 500 (`start/pages/error-page.tsx`)                    |
| `auth` / `authWide`  | 28/40rem | `AuthShell`: sign-in, setup, invite links / consent, connect            |

- **Use a shell, not a container.** Account and console pages render
  `AccountManagementShell` → `AccountPageHeader` / `AdminPageHeader` (title,
  lede, optional compact actions, the section rail) → `AccountManagementPanel`
  sections. Stand-alone pages use `AuthShell`. Anything else starts from
  `getPageShellCss(width)` (box + the standard top/bottom rhythm) or
  `getPageContainerCss(width)` (box only, for bands like the flash row).
- **Never hand-roll `maxWidth` + `margin: 0 auto`.** Without `width: 100%` a
  box inside a flex or grid parent shrinks to its content, which is exactly
  how the account pages ended up different widths
  ([#14](https://github.com/kody-hq/kody-celld/issues/14)). The helpers
  carry `width: 100%`, the shared `pageGutter`, and `box-sizing`.
- **Sections, not cards.** Inside a shell, blocks are hairline-topped
  `AccountManagementPanel`s spaced by the shell's `gap` (per-child margins
  lose to each child's own `css()` layer). Tables are `RecordTable`; empty
  states are its `emptyLabel`, or a muted `Lede` naming the MCP capability
  that fills the section.
- **Buttons.** `SubmitButton` / `ActionForm` / `DangerForm` only: `primary`
  (green pill) for the section's one main action, `secondary` (ghost) for
  row and header actions such as Sign out, `danger` (red ring, two-step
  confirm) for anything destructive. `size="sm"` is the default; `md` is for
  the decisive action on an auth card.
- **Badges.** `ok` (green) healthy, `warn` (amber) needs attention, `danger`
  (red) failed, `neutral` everything else.

Before sending a layout change, compare two sibling pages at the same
viewport (e.g. Integrations and Email at 1440px and 390px): the rail, the
heading and the header brand should not move.

## Porting UI changes from kody

1. Find the hosted change under `packages/worker/start/` or its framework-neutral
   `client/` and `universal/` helpers. The sync manifest records source paths.
2. Keep verbatim files exact; use `npm run sync:kody` rather than editing them.
   Reconcile adapted pages with celld's existing loaders and native forms.
3. Keep authentication, ownership, CSRF, OAuth, storage and audits in the Worker.
   Do not substitute hosted's data model or add SPA navigation.
4. Run `npm run validate` and the relevant web/OAuth/community smoke scenarios.
   Run cron smoke when touching jobs.

The explorer in `start/components/package-files-explorer.tsx` retains celld's
loader, embedded mode, native file links, accessible selection, search,
directory toggles and copy controls. Its Markdown adapter uses Marked's lexer,
never its HTML renderer. Raw HTML is escaped; arbitrary resources stay blocked;
first-party media and absolute links retain their narrow allowlists.
The syntax adapter renders serialized Shiki spans as JSX text and inline
styles, preserving the existing theme classes rather than adopting hosted's
different Markdown/highlight data model.

Not ported: hosted SPA/no-flash navigation, marketing pages, Turnstile and
OG-image rendering.

## Security notes

- Documents retain first-party CSP, frame denial, referrer and no-store
  headers from `src/app/security-headers.ts`. Text is escaped by JSX; the
  package Markdown renderer never renders arbitrary HTML.
- Email HTML uses the verbatim `client/email-html-preview.ts` sanitizer:
  scripts are stripped and link targets/relations normalized. The no-referrer
  preview document is passed as React `srcDoc` to an iframe allowing only
  popups and popup escape, never scripts, forms or same-origin access.
- Secrets, token values, master keys and admin tokens never appear on a page
  except the one-time token reveal after creation.
- Failed sign-ins (password, token, console) are audited with the method but
  without the submitted value.
- The UI is `Accept: text/html` negotiated: the same URLs return JSON to API
  clients, and `wantsHtml()` refuses to treat `Sec-Fetch-Mode: cors` requests
  as browser navigations.

## Smoke

`node smoke/run.mjs web` (part of `npm run smoke`) covers the redirect
matrix, invite issuance and acceptance (short password first, reuse after),
CSRF / cross-site refusal, token create → use → revoke, secrets add/list/delete
without echoing the value, memories list/search/detail/delete, the webhooks
index (never the URL secret), every read-only page, password and token sign-in,
sessions and revoke-others, lockout after five failures, password change
checks, sign-out, the console sign-in/users/hosts/audit/config/invite flow, and
that a user cannot approve a host from their own pages.
