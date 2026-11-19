# Run a fleet

> **Verification status:** a real two-node, bucket-backed fleet was run with
> the bundled [`compose.fleet.yaml` + `compose.minio.yaml`](../compose.fleet.yaml)
> (celld 0.5.0, MinIO RELEASE.2025-09-07, Caddy 2): `npm run smoke:cron`
> through the load balancer passed (MCP, packages, secrets, jobs, fleet-wide
> cron dispatch), and stopping `node-a` left `node-b` serving all state.
> The Docker path is the recommended way to run a fleet — see
> [getting-started.md](./getting-started.md#path-b-fleet-two-nodes--a-bucket).
> This page is the manual/bare-metal equivalent and the reference for the
> knobs the compose files set.

## Minimum fleet

| Piece                         | Minimum                  | Notes                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| celld nodes                   | 1 (2+ recommended)       | With one node every write waits for the bucket (`CELLD_DURABILITY=bucket` semantics); 2+ nodes get `fleet` durability and failover.                                                                                                   |
| S3-compatible bucket          | 1, dedicated or prefixed | Needs **conditional writes** (`If-None-Match`/`If-Match`) and read-after-write consistency. AWS S3, R2, GCS (`gs://`), Azure Blob (`az://`), MinIO ≥ RELEASE.2024-04 and Tigris are known to work with celld; check `celld diagnose`. |
| TLS terminator                | 1                        | celld's listener is plain HTTP. Put Caddy/nginx/a cloud LB in front and forward `X-Forwarded-Host/Proto` with `--trust-forwarded-headers`.                                                                                            |
| Private network between nodes | required for 2+ nodes    | Peer/operator traffic has no TLS or auth of its own. Use a VPC, WireGuard/Tailscale, or similar; never advertise a public IP.                                                                                                         |
| Local disk per node           | a few GB                 | `CELLD_WATCH` holds the SQLite working set and replication logs.                                                                                                                                                                      |

## 1. Generate operator secrets (once)

```sh
export KODY_ADMIN_TOKEN=$(openssl rand -hex 32)   # ≥ 24 chars enforced
export KODY_MASTER_KEY=$(openssl rand -hex 32)    # ≥ 32 chars enforced; losing it loses all user secrets
export KODY_PUBLIC_URL=https://kody.example.com   # https:// enforced by the renderer
```

Store them in your secret manager. The Worker refuses non-loopback requests
while the `wrangler.jsonc` placeholders are in effect, so a deploy that forgets
to render the fleet config fails closed with `insecure_configuration`.

## 2. Bucket credentials

```sh
export CELLD_BUCKET=s3://my-kody-bucket/kody-celld      # prefix optional; lets fleets share a bucket
export AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...  AWS_REGION=us-east-1
export S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # only for non-AWS S3-compatibles
celld diagnose --bucket $CELLD_BUCKET        # probes conditional write + list; fix before continuing
```

## 3. Deploy the Worker to the bucket

```sh
npm ci
npm run fleet:deploy
# = node scripts/render-fleet-config.mjs   → wrangler.fleet.jsonc (git-ignored, mode 600)
#   celld deploy wrangler.fleet.jsonc      → bundles with esbuild, writes version to the bucket
```

Running nodes poll the deployment pointer and adopt the new version in place;
nothing restarts. Re-run `fleet:deploy` for every code change.

## 4. Start nodes

On each node, install Node 24 and keep a checkout of this repository alongside
celld. Use the same bucket environment as step 2 and the same
`KODY_PRIVATE_HOSTS` value used for deployment. Other Worker vars are already
baked into the deployed version. Run this command from the checkout:

```sh
export CELLD_WATCH=/var/lib/celld
export CELLD_NODE=node-a                      # stable per node and disk; see below
node docker/with-egress.mjs celld --bucket "$CELLD_BUCKET" \
      --listen 0.0.0.0:8080 \
      --internal-listen 10.0.0.5:9000 \
      --advertise 10.0.0.5:9000 \
      --trust-forwarded-headers
```

The wrapper starts and supervises the loopback outbound forwarder before
starting celld. Bare-metal installations upgrading from a direct `celld`
command must update their service to use this wrapper; otherwise outbound
requests fail with `egress_unavailable`. Keep the checkout updated with the
deployed Worker. Use a private NIC for the internal listener and advertise the
address peers can dial. Enable `--trust-forwarded-headers` only when the TLS
terminator sets `X-Forwarded-Host` and `X-Forwarded-Proto`.

Repeat on further nodes with their own private addresses and their own
`CELLD_NODE`. The cron trigger
(`* * * * *`) is fleet-wide: celld elects one owner for the scheduled handler,
so jobs dispatch once per minute, not once per node.

Systemd sketch:

```ini
[Service]
WorkingDirectory=/opt/kody-celld
EnvironmentFile=/etc/kody-celld/node.env    # bucket + AWS_* + CELLD_NODE + CELLD_* + KODY_PRIVATE_HOSTS
ExecStart=/usr/bin/node /opt/kody-celld/docker/with-egress.mjs /usr/local/bin/celld --bucket ${CELLD_BUCKET} --listen 0.0.0.0:8080 --internal-listen ${PRIVATE_IP}:9000 --advertise ${PRIVATE_IP}:9000 --trust-forwarded-headers
Restart=always
RestartSec=10s                               # at least CELLD_TTL_MS
StartLimitIntervalSec=0                      # no attempt limit
```

Adjust the checkout and binary paths to match each node's installation.

## Node identity and restarts

celld's [supervisor contract](https://github.com/denoland/celld/blob/main/docs/guarantees.md#the-supervisor)
says to restart a node without an attempt limit and to wait at least one lease
lifetime (`CELLD_TTL_MS`, default 10000 ms) between attempts. A node that cannot
renew its lease in the bucket within that lifetime fences itself and exits with
code 3. When the bucket is unreachable, every node fences at about the same
moment.

Each node must also keep one `CELLD_NODE` for the life of its disk
(`CELLD_WATCH`). celld acknowledges a fleet write once a peer has it on disk, so
after a fence that peer is the only witness for the writes the dead session had
not yet uploaded. Without `CELLD_NODE`, celld picks a random ID for every
process, so the restarted peer answers as a different session and recovery
refuses to seal the dead session's log (`no complete true witness ... refusing
to seal`). Cells that session owned, including `.cron:kody-celld`, stay
unreachable. With a stable ID, the restarted process recovers its own log at
startup and answers its peers as the same witness.

`compose.fleet.yaml` does both: each node sets `CELLD_NODE` to its service name
next to its own volume, and the `node` entrypoint mode waits one lease lifetime
before every celld start. The entrypoint refuses to start a node without
`CELLD_NODE`. Rules for your own nodes:

- Never run two processes with the same `CELLD_NODE`, and never move an ID to a
  different disk. A new disk gets a new ID.
- A bare-metal supervisor needs its own delay: `RestartSec` of at least
  `CELLD_TTL_MS` for systemd, as in the sketch above.

### Tuning `CELLD_TTL_MS`

Set `CELLD_TTL_MS` in `.env`; the compose file passes it to every node and the
entrypoint waits that long. A node renews its lease every third of the lifetime
and fences when no renewal lands within the lifetime, so it rides out a bucket
stall of up to about two thirds of it (about 6.7 s at the default). A longer
lifetime rides out a longer stall, but a crashed node's cells then wait that much
longer before a peer takes them over, and every start waits one lifetime. It
does not prevent the stuck recovery above: only a stable `CELLD_NODE` does. With
stable IDs, a fleet that fenced during an outage recovers on its own once the
bucket is reachable again. Use the same value on every node.

### Unsticking a fleet that already lost its node IDs

celld has no command to force-seal a dead session. Its documented path is to
start a process with the dead session's `CELLD_NODE` on the same disk, which
recovers that log at startup (celld `docs/guarantees.md`, "The ownership
record"). For a fleet stuck after a fence that ran without stable IDs:

1. For each node, find the last session that ran on its disk before the fence:
   the `node=node_...` field of that node's `node_lease_attempt` and
   `SELF-FENCE` log lines (`docker compose logs node-a`). The stuck sessions are
   the ones named in `node-log recovery for node_.../...` errors, and their
   witnesses are the IDs in `no complete true witness among {...}`.
2. Restart the node whose disk holds a witness with `CELLD_NODE` set to that old
   ID, for example with a temporary compose override:

   ```yaml
   # compose.unstick.yaml
   services:
     node-b:
       environment:
         CELLD_NODE: node_08118e75f86dc85d0bb6831a098bfdd8
   ```

   ```sh
   docker compose -f compose.fleet.yaml -f compose.minio.yaml -f compose.unstick.yaml up -d --no-deps node-b
   ```

   With `RUST_LOG=info` (`CELLD_RUST_LOG` in `.env`) the peer logs
   `node log recovered and sealed` for the stuck session, and the
   `refusing to seal` errors stop. Repeat for each node that holds a witness.

3. Put the nodes back on their stable IDs **one node at a time**:
   `docker compose up -d --no-deps node-b`, then wait for the next node until
   the others log `node log recovered and sealed` for the old ID. A node
   stopped while its peers are up hands its log to them. Restarting every node
   at once repeats the fleet-wide loss of witnesses.

Stopping the nodes or moving them to new addresses also ends the loop, but
celld then declares a bounded loss of the writes only the old disks held.

## 5. TLS terminator

Caddyfile example:

```
kody.example.com {
	reverse_proxy 10.0.0.5:8080 10.0.0.6:8080 {
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
}
```

`KODY_PUBLIC_URL` must equal the public origin; `/health` echoes the MCP URL
it believes in.

## 6. Bootstrap and verify

```sh
curl -s https://kody.example.com/health
curl -s -X POST https://kody.example.com/admin/users \
  -H "authorization: Bearer $KODY_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"email":"kent@example.com"}'            # -> { user, token }

# run the smoke scenarios that do not need a local echo server against the fleet
for s in mcp packages jobs; do
  KODY_URL=https://kody.example.com KODY_ADMIN_TOKEN=$KODY_ADMIN_TOKEN node smoke/run.mjs --only $s
done
```

The `secrets` scenario starts an HTTP echo server to prove injection and
denial without touching a third party. The Worker must be able to reach it:
set `SMOKE_ECHO_HOST` to the name the nodes can resolve (it binds `0.0.0.0`
when that is not loopback) and render `KODY_PRIVATE_HOSTS=<that
host>` into the config for the duration of the test. The compose fleet does
this with `host.docker.internal`.

## Operations

- **Rotate the admin token:** re-render + `fleet:deploy`. Existing user tokens
  are unaffected.
- **Rotate the master key:** see [secrets.md](./secrets.md#master-key-rotation).
- **Inspect cells:** `celld cell list UserCell --bucket $CELLD_BUCKET`.
- **Logs:** node stdout (`RUST_LOG=info`), plus `GET /admin/users/:id/runs`
  for per-user run history and gateway events.
- **Backups:** the bucket _is_ the durable copy; snapshot it with your
  provider's versioning/replication. User blobs live in the same bucket under
  `r2/kody-blobs/` unless you switch to `KODY_BLOB_PROVIDER=s3`
  ([blobs.md](./blobs.md)).
- **Browser rendering:** run one browserless container reachable from every
  node and set `KODY_BROWSER_*` before `fleet:deploy` ([browser.md](./browser.md)).

## Verified and not verified

Verified with the compose fleet on one Docker host:

- Deploy to a MinIO bucket, two nodes adopting the deployment, Caddy
  round-robin in front.
- Full smoke (`mcp`, `packages`, `secrets`, `jobs`) plus a real fleet-wide
  cron dispatch through the load balancer.
- Node loss: `docker compose stop node-a`, then the full smoke again against
  `node-b` alone, which served the state written earlier through `node-a`.

Not verified here (nothing in the code depends on it, but measure before you
rely on it):

- Nodes on separate machines over a real private network (same celld
  mechanics, different latency).
- Bucket providers other than MinIO and what celld's own test-suite covers
  (AWS S3, R2, GCS, Azure are supported by celld).
- Performance under concurrent `execute` load (Worker Loader isolate reuse is
  per node; a fleet cold-starts per node).
