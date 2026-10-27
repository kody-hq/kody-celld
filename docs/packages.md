# Packages

A package is a set of files saved into the caller's `UserCell`. The format is
the production Kody manifest so packages move between kody.codes and a
self-hosted node unchanged.

## Manifest

```json
{
  "name": "@kody-smoke/counter",
  "version": "1.0.0",
  "description": "Durable counter backed by packageStorage(), with a recurring tick job.",
  "exports": {
    ".": "./status.js",
    "./increment": "./increment.js",
    "./tick": "./tick.js"
  },
  "kody": {
    "hidden": false,
    "dependencies": { "@kody-smoke/other": "^1" },
    "jobs": {
      "tick": { "entry": "./tick.js", "schedule": { "type": "interval", "every": "1m" } }
    }
  }
}
```

Rules enforced by `src/packages/manifest.ts` on `packageSave`:

- valid npm-style `name` (scoped or not), `version`, `description`;
- non-empty `README.md` (for humans) and `AGENTS.md` (for agents; `search`
  surfaces it);
- `exports` must point at files present in the upload; `.` is the default
  export used by `packageRun` when no `export` is given;
- `kody.jobs[*].entry` must be an uploaded module and `schedule` must parse
  (see [jobs.md](./jobs.md));
- static relative imports reached from `exports`, job entries and subscription
  handlers must resolve to a module in the package (`x`, `x.js`, `x/index.js`;
  code and JSON only), so a broken import is refused with `invalid_import`
  instead of failing the run later; unreached files (tests, client code),
  dynamic `import()`, and imports that compiled TypeScript or JSX no longer has
  (`import type`, imports used only as types) are not checked. Install, fork
  and preview apply the same check;
- `kody.app` (`entry`, optional `assets` and `client`) declares a browser app
  served on its own origin; `entry` must be an uploaded module. See
  [package-apps.md](./package-apps.md);
- `kody.dependencies` is validated and kept on the manifest for tooling; at run
  time packages simply `import` each other via `kody:@scope/pkg/...` (there is
  no install step).

## Subscriptions

Declare package event handlers under `kody.subscriptions`, keyed by topic.
Celld emits `email.message.received`, `email.message.quarantined`,
`email.message.delivery.updated`, `integration.auth.succeeded`, and
`integration.auth.failed`. Other non-empty topic strings are saved with a
warning, but no celld event triggers them. Subscription handlers must still
name an uploaded file. `filters` on platform topics are not applied and produce
a warning. Filters on package-emitted topics are retained without a warning,
but those handlers are not delivered events yet.

## Emitted topics (`kody.emits`)

Declare emitted event topics in `kody.emits`. Topics must use the scoped form
`@scope/topic.name`, with a lower-dot-case body and the same scope as the
package name. Each entry requires a description and can include a JSON Schema
subset payload schema with root `"type": "object"`.

```json
{
  "name": "@example/tasks",
  "kody": {
    "emits": {
      "@example/task.created": {
        "description": "A task was created.",
        "payloadSchema": {
          "type": "object",
          "properties": {
            "taskId": { "type": "string" }
          },
          "required": ["taskId"]
        }
      }
    }
  }
}
```

Celld parses and validates these declarations, but `events.dispatch` and
delivery to subscriber handlers are not available yet. The `mcp: true` flag is
ignored with a warning. Unsupported entry fields are warned about and dropped.

## Credential slots

Declare package credential slots under `kody.credentials`. Slot names start
with a letter and may contain letters, numbers, dots, underscores, and
hyphens. Each slot requires a description from 1 to 500 characters.

```json
{
  "kody": {
    "credentials": {
      "github": {
        "kind": "oauth",
        "provider": "github",
        "description": "Read issues from GitHub"
      }
    }
  }
}
```

`kind` is optional and accepts `secret`, `oauth`, `mcp`, `url`, `login`, or
`signing`. `provider` is optional. When present, celld trims surrounding whitespace and requires 1-64 characters; it rejects longer values instead of truncating them. Celld does not
default it to the slot name. `multiple` is an optional boolean. Celld warns and drops unknown
slot fields, `placement`, and `ownerCredentialForVisitors`.

## Credential runtime

Package code can open one declared credential with `credential('github')`.
`credential.named('token-name', { scope: 'user' })` selects a named credential,
and `credentials('github')` returns all matches for a slot declared with
`multiple: true`.

The runtime supports `secret`, `oauth`, and `mcp` credentials. Secret and OAuth
clients expose `fetch`; MCP clients expose `callTool(tool, args)`. Secret
values remain at the gateway, which enforces approved hosts when requests are
sent. The client-side host check is defense in depth only. The runtime does
not expose `sign()`. Manifest-only `url`, `login`, and `signing` slots fail with
`credential_unsupported` when opened.

## TypeScript and JSX

`.ts`, `.mts`, `.tsx` and `.jsx` package files are compiled when they run, as hosted kody does with esbuild; here it's sucrase. Ad hoc `execute` code is read as TypeScript. Package files are stored exactly as written. Types are removed, not checked.

- `enum`, constructor parameter properties, `satisfies` and `as` work.
- `import type`, and named imports used only as types, are dropped, as `tsc` does, so they need not resolve. Side-effect imports (`import './x.ts'`) stay.
- JSX uses `compilerOptions.jsx` and `jsxImportSource` from the package's root `tsconfig.json` (comments allowed).
  - `react-jsx` selects the automatic runtime, for example `"jsxImportSource": "remix/component"`.
  - A `/** @jsxImportSource … */` or `/** @jsxRuntime classic */` comment at the top of a file (before its first statement, as in TypeScript) wins.
  - Without either, JSX compiles to `React.createElement`.
  - The automatic runtime imports `<source>/jsx-runtime` like any npm import.
- `.d.ts` files are never loaded or imported.
- A file that cannot be read fails only when the entry reaches it, with `invalid_module` naming the file. JSON that does not parse, such as a `tsconfig.json` with comments, fails only if imported.

## Lifecycle capabilities

| Capability                                                                                         | From `execute`?                               | Notes                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packageSave({ files })`                                                                           | yes                                           | `files` is `{ "path": "contents" }`. Total ≤ 4 MiB; each file ≤ ~1.8 MiB (Durable Object SQLite bind cap). Both limits fail with a clear error naming the cap. Each file is stored in its own SQLite row. Re-saving reconciles jobs (adds, updates schedule, removes). |
| `packageList()` / `packageGet({ name })`                                                           | yes                                           | `packageGet` returns manifest, README, AGENTS, file list.                                                                                                                                                                                                              |
| `packageDelete({ name })`                                                                          | yes                                           | Also deletes its jobs. Package storage is kept until `packageStorageClear`.                                                                                                                                                                                            |
| `packageRun({ name, export?, params? })`                                                           | **no** (host only via `/api/call/packageRun`) | Inside a run, import the export instead — it is cheaper and keeps one run record.                                                                                                                                                                                      |
| `packageStorageInspect({ packageName, prefix?, limit? })` / `packageStorageClear({ packageName })` | yes (a package may only inspect its own)      | KV entries, KV count, SQL tables.                                                                                                                                                                                                                                      |

## Workflows

`workflows.create()` queues durable work for a package export or inline code.
See [workflows.md](./workflows.md) for arguments, idempotency, retries, and
cancellation. The account Workflows page at `/account/workflows` lists and cancels workflows.

## Importing packages from code

```ts
import status from 'kody:@kody-smoke/counter' // "." export
import increment from 'kody:@kody-smoke/counter/increment'
export default async () => {
  await increment({ by: 2 })
  return status()
}
```

The module graph (`src/execute/module-graph.ts`) pulls the package's files into
the isolate under `packages/<name>/<path>`, rewrites its imports to paths
relative to the importing module, and stamps `packageStorage()` →
`packageStorage('<name>')`. Transitive `kody:` imports between packages work
the same way. Cycles are rejected.

## `packageStorage()`

```ts
import { packageStorage } from 'kody:runtime'
const store = packageStorage()
await store.set('count', 1) // JSON values
await store.get('count')
await store.list({ prefix: 'user:', limit: 50 })
await store.delete('count')
await store.sql('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, kind TEXT)')
await store.sql('INSERT INTO events (kind) VALUES (?)', 'tick') // -> { rows, rowsWritten, ... }
await store.clear()
store.id // 'package-storage:@kody-smoke/counter'
```

Each `(user, package)` gets its own `PackageStorageCell` Durable Object — a
private SQLite database. `__kody_kv` is the KV table; anything else is the
package's own schema. Only the declaring package's code can obtain its
storage handle; ad hoc `execute` code calling `packageStorage()` gets a clear
error. Deleting a package does **not** clear its storage (call
`packageStorageClear` first if that is what you want).

## Install from GitHub, kody.codes, or a URL

`packageInstall` downloads a package on the server and saves it exactly like
`packageSave` (same manifest validation, same 4 MiB cap), recording where it
came from in `source` so `packageUpdate` can pull it again later.
`packagePreview` fetches the same way **without** saving — use it to inspect
manifest, README, files, and declared surfaces before an explicit install or
fork. Secrets are never transferred from the remote.

```ts
import { kody } from 'kody:runtime'
export default async function main() {
  // GitHub: github:owner/repo[/sub/dir][#ref] or a github.com URL
  await kody.packageInstall({ source: 'github:kody-hq/kody-celld/examples/packages/http-probe#main' })
  await kody.packageInstall({ source: 'https://github.com/owner/repo/tree/v1.2.0/packages/hello' })
  // Public kody.codes package: listing URL or `.git` (read-only smart-HTTP clone)
  const preview = await kody.packagePreview({ source: 'https://kody.codes/@kody/cloudflare' })
  await kody.packageInstall({ source: 'https://kody.codes/@kody/cloudflare.git' })
  await kody.packageInstall({ source: 'kody:@kody/cloudflare', as: '@me/cloudflare' }) // fork
  // Any http(s) tarball (.tar.gz / .tgz) or JSON file map ({ "package.json": "...", ... } or { files: {...} })
  await kody.packageInstall({ source: 'https://example-cdn.test/hello-1.0.0.tgz', subdir: 'package' })
  // Later: re-fetch from the recorded source
  return await kody.packageUpdate({ name: preview.name })
}
```

The same preview → install / fork flow is on the account **Packages** page. Rules:

- GitHub sources become `https://codeload.github.com/<owner>/<repo>/tar.gz/<ref>`
  (`HEAD` when no ref is given); the archive's common root directory is
  stripped and `subdir` (or the path in the source) selects the package root.
  When `package.json` is missing there, the error lists directories that do
  have one.
- Public **kody.codes** listing URLs (`https://kody.codes/@owner/leaf`) and
  `.git` URLs are cloned read-only over Git smart-HTTP (`…/@owner/leaf.git`).
  Shorthand: `kody:@owner/leaf[#ref]`. Provenance is stored as the `.git` URL
  (or `/tree/<ref>/<subdir>` when a subdir was selected). Hosted Kody must
  expose the upload-pack route; until that ships, preview/install fails with a
  clear remote error — Celld does not scrape the HTML listing page.
- Only `http(s)` URLs without embedded credentials, on a built-in public
  source (GitHub's hosts **and** `kody.codes`) or a host listed in
  `KODY_PRIVATE_HOSTS` (exact hosts, `*.suffix`, IPs and CIDR ranges).
  Loopback/private/link-local addresses and `.local` / `.internal` /
  single-label names are refused unless listed there — do that for a
  Gitea/Forgejo/GitLab on your LAN. Every redirect hop is re-checked (max 3).
- Every hop's hostname (including the built-in GitHub hosts and the GitHub
  commit lookup) is also resolved through `KODY_DNS_RESOLVER_URL`, and the hop
  is refused with `package_source_refused` if any answer is a private address
  that no IP/CIDR entry of `KODY_PRIVATE_HOSTS` allows, or if the lookup fails.
  Names listed by name or `*.suffix` skip the lookup. The fast-rebinding limit
  in [mcp-servers.md](./mcp-servers.md) applies here too.
- Limits: 8 MiB download, 24 MiB after gunzip / unpacked git tree, 400 files,
  20 s. `.git/` and `node_modules/` are skipped, non-UTF-8 files are skipped
  with a warning.
- `packagePreview` returns declared surfaces (jobs, webhooks, subscriptions,
  secretProvider, dependencies) as "permissions" for human review — these are
  not a separate ACL, and installing still does not copy secrets.
- Pass `path` (an entry of `fileList`) to `packagePreview` to read that file
  before installing: the result gains `file: { path, bytes, content, truncated }`
  (content capped at 200,000 characters; unknown paths fail with
  `package_file_not_found`). On the web Packages page, **Preview → Browse files** opens the package in the
  files explorer (tree, highlighted code, rendered Markdown) before you install
  it; installed packages use the same explorer under
  `/account/packages/<name>/files`.
- Pass `as` on `packageInstall` (or Fork on the web form) to rewrite
  `package.json#name` like a community fork; `packageUpdate` refuses forks.
- Package code cannot call `packageInstall`/`packageUpdate` (403); only the
  user (via MCP `execute`, the REST call surface or the web UI) can.
- `packageUpdate` works for `github:`/kody/URL sources and for community
  installs (`community:<name>@<version>`); packages saved from an in-memory
  file map or forks have nothing to update from.

## Sharing packages

The node has a public **community catalog** where users publish their saved
packages and others install or fork them — see [community.md](./community.md).
Public packages on kody.codes import via the `.git` / listing URL path above
(preview, then explicit install); the deployment-local catalog stays intentional
and is not a live federation of the hosted registry.

## npm dependencies

Bare imports inside a run or package (`import ms from 'ms@2.1.3'`) are
resolved through an esm.sh-compatible CDN at graph-build time, cached in the
durable `NpmCacheCell` and inlined into the isolate. See [npm.md](./npm.md)
for configuration, the self-hosted CDN overlay and limits.
