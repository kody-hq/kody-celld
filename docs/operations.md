# Operations: limits, quotas, usage, audit

Everything an operator can tune or inspect at run time, beyond the secrets and
fleet mechanics covered in [secrets.md](./secrets.md) and
[run-fleet.md](./run-fleet.md), and the AI/vector settings in [ai.md](./ai.md). All of it is built in; nothing here needs an
external service.

Every setting is an environment variable read by the Worker (`src/lib/limits.ts`).
Set them in `.env` for Docker (`compose.yaml` and `compose.fleet.yaml` pass them
through), in `.dev.vars` for local `celld.dev`, or in the rendered fleet config.
On a single-node Docker install the entrypoint writes operator env into
`.dev.vars`, deploys the Worker into the local store, then runs the celld node
directly. Restart the container after changing env so the deploy step picks
them up. On a fleet they are baked into the deployed Worker config: re-run the
`deploy` service (or `celld deploy`) after changing them. Invalid values fail
loudly at startup rather than silently falling back.

## Single-node Docker startup

`command: ['single']` (the `compose.yaml` default) keeps durable state in the
`kody-data` volume at `/data/celld/dev` (the same layout `celld.dev` uses). Each
start:

1. Writes `/app/.dev.vars` from operator env (admin token, master key, tunables).
2. Runs a short `celld.dev` only long enough to publish a new deployment into
   that local store (`deploy/current.json`).
3. Stops the `celld.dev` supervisor and `exec`s the celld node directly against
   the same store (`--no-control-plane --bucket celld-dev` with
   `CELLD_INTERNAL_DEV_STORE`), matching the child process `celld.dev` itself
   would spawn.

The long-running process is therefore the node, not the `celld.dev` wrapper.
That matters once the local store has grown: the wrapper waits a fixed ~30s for
the child to announce its operator listener, and a large uncompacted LTX backlog
can miss that window and crash-loop the container
([issue #89](https://github.com/kody-hq/kody-celld/issues/89)). The direct
node has no announce deadline and runs LTX compaction.

Existing volumes keep working across image upgrades; the store layout is
unchanged. Optional: `CELLD_DEV_FLAGS` is forwarded to the short deploy-step
`celld.dev` only (for example `--logs`). `KODY_SINGLE_DEPLOY_TIMEOUT_MS`
(default `600000`) caps how long the deploy step may take before failing
loudly with a path to `/data/celld/dev/.last-deploy.log`.

### LTX epoch retention (single node)

Threshold compaction only folds L0 segments **within the current epoch**.
Superseded epochs stay in the local store until celld's epoch GC runs, and that
GC is off unless `CELLD_LTX_RETENTION_SECS` is positive (celld default: unset,
no deletion). Without it, a long-lived single-node volume can keep hundreds of
thousands of old-epoch L0 objects; every cold cell restore then spends most of
its time in an unindexed full-table listing of the local store (celld
`LocalStore::list` over `objects.sqlite3`).

`single` mode therefore defaults `CELLD_LTX_RETENTION_SECS` to `86400` (one day
of grace) when the variable is unset or empty. **This changes the default for
existing single-mode installs on upgrade:** celld begins deleting eligible
superseded epochs after the grace. Set `CELLD_LTX_RETENTION_SECS=0` to keep
celld's previous no-deletion default.

celld deletes only epoch prefixes that sit below the cell's restore-chain base
and are proven unreachable by the owner GC plan (`denoland/celld`
`crates/logic/epoch_gc.rs`): never the current owner epoch, never the epoch
immediately before it, never the chain base or anything above it, and nothing
while a paged cell still pins older objects. See `docker/epoch-gc-plan.test.mjs`
for the locked predicates.

There is no `CELLD_DURABILITY=single`. celld only accepts `fleet` or `bucket`
and defaults to `fleet`. Docker `single` leaves that default alone, so the
node_log maintenance tick (which calls `gc_superseded_epochs`) runs. Setting
`CELLD_DURABILITY=bucket` with a positive retention fails startup loudly,
because bucket durability never spawns that maintenance loop.

After upgrading an already-large volume, leave the node running: cells must
activate, finish any paged hydrate, and take a write before a pass can delete,
and each pass deletes at most 64 epochs per cell. Cold-restore listing cost
shrinks as superseded objects go away.

### Covered L0 cleanup (single node)

celld deletes LTX objects only by whole epoch, so inside the current and
previous epoch every L0 object stays even after a compaction (L1 and up, or a
handoff snapshot) holds the same transactions. On a busy single node that is
most of the store
([issue #179](https://github.com/kody-hq/kody-celld/issues/179)). After the
deploy step and before the node starts, `docker/local-ltx-gc.mjs` deletes an L0
object only when a level 1+ object of the same cell and epoch covers its whole
TXID range, that covering object is older than `CELLD_LTX_RETENTION_SECS`, and
every latest restore of the cell (celld's epoch chain from the newest epoch,
and from each older epoch) resolves to the same chain and transaction without
it. Epochs are never removed here, so the previous-epoch fallback and
point-in-time restores inside the grace reach exactly as far as before. It runs
in one transaction (a crash rolls back), keeps and logs any cell whose restore
already fails or would change, and does nothing when
`CELLD_LTX_RETENTION_SECS` is `0`.

To see what the next start would delete without deleting anything:

```sh
docker exec <container> node /app/docker/single-local.mjs ltx-gc --state /data/celld/dev --dry-run
```

SQLite reuses the freed pages, so the file stops growing but does not shrink.
To return the space to the disk, stop the container and run
`sqlite3 /data/celld/dev/objects.sqlite3 VACUUM` (needs free space about the
size of the store).

### Seeing what commits in a cell

Every committed cell transaction becomes one L0 LTX object, so the L0 growth
rate is the write rate. Set `KODY_DEBUG_CELL_WRITES=1` (any mode; restart to
apply) to log each SQL statement that changes rows, with the cell class and
the calling method:

```text
[kody-celld] cell-write UserCell rows=1 via=UserCell.jobsClaimDue UPDATE jobs SET next_run_at = ?, ...
```

Only the statement text is logged: bound values and inline string or blob
literals are blanked. Lines are written as each statement runs, so several
lines can belong to one transaction, and a statement whose transaction later
rolls back is still logged. Statements that change no rows (for example
`INSERT ... ON CONFLICT DO NOTHING` on an existing row) are not logged. Writes celld makes itself are
not app SQL and are not logged: the reserved `.cron` cell re-arms its alarm
about once a minute for the `* * * * *` trigger. Leave the switch off in normal
operation; it logs one line per written statement.

What a quiet single node writes (measured with the switch on):

- Idle with no jobs: nothing in `RegistryCell` or `UserCell`.
- Each scheduled job run: five `UserCell` transactions (`jobsClaimDue`,
  `jobRunStart`, `runStart`, `runFinish`, `jobRunFinish`) plus whatever the
  job itself writes (for example `PackageStorageCell`).
- Authenticated MCP or API requests: at most one `RegistryCell` token
  `last_used_at` write per token per five minutes, and one browser session
  refresh per minute. OAuth access-token checks do not write; token issue,
  refresh and revoke do.
- Sign-ins and every management change (secrets, packages, tokens, webhooks,
  integrations) append one `RegistryCell` audit row.

### HTTP read-header timeout warnings

```text
WARN celld: HTTP connections failed ... cause="timeout" ... error=read header from client timeout
```

celld closes a connection that sends no complete request head within 30
seconds, which includes an idle keep-alive waiting for its next request, and
logs it (rate limited to one line per second, with a running total). It is
harmless. The `peer` names the client: the Docker bridge gateway
(`172.17.0.1` style) means a client on the host side of the published port,
typically a reverse proxy or browser holding keep-alive connections open, or a
TCP-only uptime check. The image's own healthcheck runs inside the container
against `127.0.0.1` with complete requests and does not cause it. To silence
it, set the proxy's upstream keep-alive timeout below 30 seconds.

### Local store metadata index (single node)

celld 0.6 lists its local store by reading every row's metadata and filtering
prefixes in Rust, and `body` sits before the metadata columns in each row, so
every listing read every object body. On a 1.1 GB store an idle node read about
2 GB/s and used two cores
([issue #179](https://github.com/kody-hq/kody-celld/issues/179)). The `single`
deploy step therefore adds a covering index, `objects_metadata`, to
`objects.sqlite3` right after the deploy and before the node starts; the same
store then reads about 12 MB/s idle. Building it on an existing volume reads
the store once (about 0.6 s per GB). The step fails loudly if celld changes the
`objects` table columns. It goes away once the pinned celld indexes its own
store.

## Runtime limits

| Variable                       | Default    | Range           | Effect                                                                                                                                                                                          |
| ------------------------------ | ---------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KODY_EXECUTE_TIMEOUT_MS`      | `60000`    | 1 s … 15 min    | Wall-clock cap per run (`execute`, `packageRun`, jobs) and per package-app request. Exceeding it → `execute_timeout` (504).                                                                     |
| `KODY_RUN_RETENTION_COUNT`     | `500`      | 10 … 100 000    | Newest runs kept per user; older finished rows are pruned as runs start and finish.                                                                                                             |
| `KODY_RUN_RETENTION_DAYS`      | `0`        | 0 … 3650        | Also drop runs older than N days (`0` = count-only).                                                                                                                                            |
| `KODY_RUN_LOG_LIMIT`           | `200`      | 0 … 10 000      | Console entries persisted per run (the run response is capped the same way).                                                                                                                    |
| `KODY_RESPONSE_LIMIT_BYTES`    | `100000`   | 1 KB … 10 MB    | Default `responseLimit` for `execute` results; callers may pass a smaller one.                                                                                                                  |
| `KODY_AUDIT_RETENTION_COUNT`   | `10000`    | 100 … 1 000 000 | Admin audit entries kept in the registry cell.                                                                                                                                                  |
| `KODY_MCP_CONTENT_LIMIT_BYTES` | `512000`   | 10 KB … 50 MB   | Serialized cap for `__mcpContent` blocks (images/audio) an `execute` run may return ([browser.md](./browser.md)).                                                                               |
| `KODY_MCP_CALL_TIMEOUT_MS`     | `30000`    | 1 s … 10 min    | Timeout for each MCP request of `kody.mcp[server].tool()` and discovery (connect, each tools/list page, the call); exceeding it → `mcp_call_failed` (502) ([mcp-servers.md](./mcp-servers.md)). |
| `KODY_BLOB_MAX_BYTES`          | `26214400` | 1 KB … 1 GiB    | Per-object size cap for blob uploads ([blobs.md](./blobs.md)).                                                                                                                                  |
| `KODY_APP_RESPONSE_MAX_BYTES`  | `10485760` | 1 KB … 100 MB   | Largest response body one package-app request may stream; past it the body is cut off and an `app` error run is recorded ([package-apps.md](./package-apps.md)).                                |

`GET /admin/limits` returns the effective limits and quota defaults so you can
confirm what a node actually loaded.

## Quotas

Quotas protect a shared node from one user (or one runaway agent). Defaults come
from the environment; an admin can override any subset per user. `0` means
unlimited everywhere.

| Variable                        | Counts                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `KODY_QUOTA_RUNS_PER_DAY`       | Runs started per UTC day (`execute`, `packageRun`, job runs)                            |
| `KODY_QUOTA_EXECUTE_MS_PER_DAY` | Summed run duration per UTC day                                                         |
| `KODY_QUOTA_PACKAGES`           | Saved packages                                                                          |
| `KODY_QUOTA_SECRETS`            | Stored secrets (updating an existing secret never counts)                               |
| `KODY_QUOTA_JOBS`               | Jobs registered from package manifests                                                  |
| `KODY_QUOTA_BLOBS`              | Stored blobs (objects) per user                                                         |
| `KODY_QUOTA_BLOB_BYTES`         | Total blob bytes per user (overwrites count the size delta)                             |
| `KODY_QUOTA_MCP_SERVERS`        | External MCP servers per user (`mcpServerAdd`; replacing an existing name never counts) |

Enforcement happens in the user's Durable Object, before the work starts:

- a run over `runsPerDay` / `executeMsPerDay` is rejected with
  `quota_exceeded` (HTTP 429) and is **not** recorded or counted;
- `packageSave`, `secretSet` and manifest jobs over their count are
  rejected the same way, leaving existing data untouched;
- `blobPut` (capability or `PUT /api/blobs/…`) over `blobs` / `blobBytes` is
  rejected before anything is written to the bucket;
- `executeMsPerDay` is checked against usage accumulated _before_ the run, so
  the last run of the day may finish past the line — the cap is a budget, not a
  hard kill (the timeout is the hard kill).

Usage buckets roll over at 00:00 UTC. Counting a run at start (and its duration
and error at finish) means rejected runs are free and abandoned runs still cost
one.

### Per-user overrides

```sh
ADMIN=...; BASE=http://localhost:8080; USER_ID=usr_...
curl -s $BASE/admin/users/$USER_ID/quota -H "authorization: Bearer $ADMIN"
curl -s -X PUT $BASE/admin/users/$USER_ID/quota -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"runsPerDay": 2000, "secrets": 50}'
curl -s -X DELETE $BASE/admin/users/$USER_ID/quota -H "authorization: Bearer $ADMIN"
```

`PUT` replaces the whole override (keys omitted fall back to the environment
defaults); `DELETE` removes it. Both are audited.

## Usage

Users see their own numbers through the `usageGet` capability (discoverable via
`search`, e.g. "how many runs do I have left"):

```js
import { kody } from 'kody:runtime'
export default async () => kody.usageGet({ days: 7 })
// → { day, today: { runs, errors, executeMs }, history: [...],
//     counts: { packages, secrets, jobs, runsRetained },
//     quotas: { runsPerDay, ... }, quotaOverride, limits: { executeTimeoutMs, ... } }
```

Operators get the same report for any user with
`GET /admin/users/:id/usage?days=30`.

## Audit log

Every admin action and every user action that changes durable state is appended
to an append-only log in the registry cell (`GET /admin/audit`). Entries carry
`actor` (`admin` or `user:<id>`), `action`, `target`, `details` and a timestamp;
the newest `KODY_AUDIT_RETENTION_COUNT` are kept.

```sh
curl -s "$BASE/admin/audit?limit=50" -H "authorization: Bearer $ADMIN"
curl -s "$BASE/admin/audit?actor=admin&action=secret_host." -H "authorization: Bearer $ADMIN"
```

`action` filters by prefix. Actions recorded today:

| Action                                                                                                                                                                    | Actor | Target               | Details                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------- | ----------------------------------------------------------------------- |
| `user.create`, `token.issue`                                                                                                                                              | admin | user id              | email / label                                                           |
| `token.issue`, `token.rotate`, `token.revoke`                                                                                                                             | user  | user id / token id   | token kind, name, created via (never token values)                      |
| `secret_host.approve`, `secret_host.revoke`                                                                                                                               | admin | user id              | host                                                                    |
| `quota.set`, `quota.clear`                                                                                                                                                | admin | user id              | the override                                                            |
| `jobs.dispatch`                                                                                                                                                           | admin | —                    | jobs ran / skipped                                                      |
| `secret.rekey`                                                                                                                                                            | admin | —                    | current key id, rows resealed / remaining                               |
| `memory.reindex`                                                                                                                                                          | admin | user id              | embedding model, rows re-embedded                                       |
| `secret.save`, `secret.delete`                                                                                                                                            | user  | secret name          | scope, package name                                                     |
| `package.save`, `package.delete`                                                                                                                                          | user  | package name         | version, source, job names                                              |
| `job.enable`, `job.disable`                                                                                                                                               | user  | job id               | —                                                                       |
| `memory.create`, `memory.update`, `memory.delete.soft`, `memory.delete.hard`                                                                                              | user  | memory id            | category, status, package (never the text)                              |
| `webhook.mint`, `webhook.rotate`, `webhook.delete`, `webhook.apply`, `webhook.reveal`                                                                                     | user  | handle               | package + webhook name, provider host (never the URL secret)            |
| `email.inbox.claim`, `email.inbox.release`, `email.destination.verify`, `email.send`                                                                                      | user  | address / message id | provider, recipient count (never bodies or codes)                       |
| `integration.save`, `integration.connect_start`, `integration.connect`, `integration.connect_failed`, `integration.usage`, `integration.disconnect`, `integration.delete` | user  | integration name     | provider, flow, hosts, failure code (never tokens or client secrets)    |
| `secret_provider.bind`, `secret_provider.unbind`, `secret_provider.lock`, `secret_provider.grant`, `secret_provider.revoke`                                               | user  | provider id          | package name, ref, locked flag (never config values or resolved values) |

**What is never in the log:** secret values, encrypted blobs, API tokens, the
admin token, master keys, run code or run results. Callers pass names and ids
only (`src/lib/audit.ts`), and the smoke test asserts that a freshly generated
secret value and a user token do not appear anywhere in `GET /admin/audit`.
The log is a record of _who changed what_, not a copy of the data.

## Email and webhook limits

| Variable                            | Default    | Notes                                                                |
| ----------------------------------- | ---------- | -------------------------------------------------------------------- |
| `KODY_WEBHOOK_MAX_BODY_BYTES`       | `1048576`  | Inbound webhook body cap (`413`).                                    |
| `KODY_EMAIL_MAX_BYTES`              | `10485760` | Stored size per message incl. attachments (`413` / SMTP `552`).      |
| `KODY_QUOTA_EMAIL_MESSAGES`         | `0`        | Stored messages per user; oldest are not evicted, new are refused.   |
| `KODY_QUOTA_EMAIL_SENDS_PER_DAY`    | `0`        | `emailSend`/`emailReply` per user per UTC day.                       |
| `KODY_QUOTA_EMAIL_RECEIVES_PER_DAY` | `0`        | Accepted inbound messages per user per UTC day (`429` / SMTP `452`). |

Per-webhook rate limits come from the package manifest
(`rateLimitPerMinute`, capped at 600). Email counters show up in `usageGet`
(`emailMessages`, `emailSends`, `emailReceives`). See [email.md](./email.md) and [webhooks.md](./webhooks.md).

## Integrations and secret providers

| Variable                             | Default                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KODY_PUBLIC_URL`                    | —                                      | OAuth redirect URI is `${KODY_PUBLIC_URL}/connect/oauth/callback`; register it in each OAuth app ([integrations.md](./integrations.md)).                                                                                                                                                                                                                                                                                           |
| `KODY_APP_BASE_URL`                  | unset                                  | Origin that serves package apps; unset = apps off. `https://apps.example.com` = path mode, `https://*.apps.example.com` = subdomain mode. Must differ from the `KODY_PUBLIC_URL` host; SHOULD use a different registrable domain (startup warns when they share one). An invalid value keeps apps off and shows in `/health` ([package-apps.md](./package-apps.md)).                                                               |
| `KODY_SECRET_PROVIDER_CACHE_SECONDS` | `300`                                  | In-memory TTL for resolved `{{secret/…}}` values in the user cell; `0` disables caching ([secret-providers.md](./secret-providers.md)).                                                                                                                                                                                                                                                                                            |
| `KODY_SECRET_PROVIDER_TIMEOUT_MS`    | `20000`                                | Wall-clock cap for one sealed provider run (minimum 1000).                                                                                                                                                                                                                                                                                                                                                                         |
| `KODY_PRIVATE_HOSTS`                 | —                                      | The one private-host allowlist: comma-separated hosts, `*.suffix` wildcards, IPs and CIDR ranges (`172.30.0.0/16`) that MCP servers and their OAuth servers, the browser and package sources may reach, and that may receive secrets over plain `http:`. MCP, the browser and package sources also check resolved addresses against it ([mcp-servers.md](./mcp-servers.md)).                                                       |
| `KODY_DNS_RESOLVER_URL`              | `https://cloudflare-dns.com/dns-query` | DNS-over-HTTPS endpoint (JSON API, `https:` only) used to resolve MCP server, package source and browser `url` hostnames before each hop and refuse private answers that are not allowlisted. Point it at a LAN resolver to resolve `.home` names; it must speak the DoH JSON API (`?name=&type=` with `accept: application/dns-json`, as Cloudflare and Google do), not wireformat-only DoH ([mcp-servers.md](./mcp-servers.md)). |

## npm imports, package sources, community catalog

| Variable                  | Default          | Notes                                                                               |
| ------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `KODY_NPM_IMPORTS`        | `on`             | `off` rejects bare npm specifiers in runs and packages ([npm.md](./npm.md)).        |
| `KODY_ESM_CDN_URL`        | `https://esm.sh` | esm.sh-compatible CDN origin; point at the `compose.esm.yaml` service to self-host. |
| `KODY_NPM_CACHE_MAX_MB`   | `256`            | Durable module cache size (LRU); `0` disables the durable layer.                    |
| `KODY_NPM_CACHE_TTL_DAYS` | `30`             | Re-fetch cached modules after this long.                                            |

```sh
curl -s $BASE/admin/npm-cache -H "authorization: Bearer $ADMIN"             # config + cache stats
curl -s -X DELETE $BASE/admin/npm-cache -H "authorization: Bearer $ADMIN"   # flush (audited: npm_cache.clear)
```

Audit actions: `npm_cache.clear`, `package.install`, `package.update`,
`community.publish`, `community.unpublish`, `community.install`. The community
catalog has no operator switch; it is empty until a user publishes, and
listings are public HTML at `/community` ([community.md](./community.md)).

## Sign-in, MCP OAuth, web UI

| Variable           | Default | Notes                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KODY_PUBLIC_URL`  | —       | The OAuth **issuer** and the origin every browser form must come from. Cookies are `Secure` (and `__Host-`-prefixed) only when it is `https:`; discovery metadata, redirect handling and CORS derive from it ([mcp-oauth.md](./mcp-oauth.md), [decision 0020](./contributing/decisions/0020-host-prefixed-kody-cookies.md)). |
| `KODY_ADMIN_TOKEN` | —       | Also unlocks `/setup` (first account) and the operator console at `/console` ([web-ui.md](./web-ui.md)).                                                                                                                                                                                                                     |
| `KODY_MASTER_KEY`  | —       | Additionally signs CSRF / consent state and seals the refresh-replay snapshot; rotate with `KODY_MASTER_KEY_PREVIOUS` as for secrets ([secrets.md](./secrets.md)). Rotating it invalidates in-flight consent forms only.                                                                                                     |

Fixed protocol constants (change in `src/oauth/protocol.ts` / `src/auth/*` if
you must): authorization codes 10 min, access tokens 1 h, refresh tokens 30 d
with rotation and a 60 s replay grace, unused OAuth clients purged after 30 d,
browser sessions 30 d, console sessions 12 h, invites 7 d, magic links 15 min,
5 failed passwords → 15 min lockout per email.

Admin JSON endpoints added for the UI:

```sh
# one-time invite link (sets a password); {"reset":true} for an existing account
curl -s -X POST $BASE/admin/users/$USER/invite -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{}'
# sign a user out everywhere: browser sessions + every OAuth grant
curl -s -X POST $BASE/admin/users/$USER/signout -H "authorization: Bearer $ADMIN"
```

Audit actions: `signin`, `signin.failed`, `signin.magic_link`,
`signin.invite_accepted`, `password.set`, `password.reset`, `session.revoke`,
`token.issue`, `token.rotate`, `token.revoke`, `user.invite`, `user.signout_everywhere`,
`secret.grant`, `secret.grant.remove`,
`mcp_client.register`, `mcp_client.authorize`, `mcp_client.deny`,
`mcp_client.revoke`, `mcp_client.revoke_all`, `console.signin`,
`console.signin_failed`. Details never include submitted passwords, tokens or
codes.

## Smoke coverage

`npm run smoke` runs the `limits` scenario: `GET /admin/limits`, `usageGet`,
a per-user quota clamp that rejects the next run with `quota_exceeded` and the
second secret with the secrets quota, clearing the override, the audit log
(presence, filters, and the no-leak assertions above) and the retention bound.
Start the node with `KODY_EXECUTE_TIMEOUT_MS=5000` and run
`SMOKE_EXPECT_TIMEOUT_MS=5000 npm run smoke` to also prove a long run is cut off
at the configured timeout. The `oauth-server` and `web` scenarios cover the
authorization server and the HTML UI end to end (see the respective docs);
`npm`, `install` and `community` cover the module cache, remote package
sources (including the SSRF refusals) and the catalog.
