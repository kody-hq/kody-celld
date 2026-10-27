# Secrets

Design goal, inherited from production Kody: **sandbox code never sees a
secret value**. It sees placeholders; the host swaps them in at the network
boundary, and only for destinations approved by an account admin through the
admin API or a signed-in owner through a `/connect/secret-set` link.

## Storing

```ts
import { kody } from 'kody:runtime'
await kody.secretSet({ name: 'github', value: 'ghp_...' }) // user scope (default)
await kody.secretSet({ name: 'api-key', value: '...', scope: 'package' }) // only the saving package may use it
await kody.secretSetMany({
  secrets: [
    { name: 'api-user', value: 'alice' },
    { name: 'api-password', value: '...' },
  ],
})
await kody.secretList() // names, scopes, timestamps — never values
await kody.secretDelete({ name: 'github' })
```

`secretSet` matches the hosted capability name. `secretSave` remains as an alias
for existing celld packages. Discovery lists `secretSet` as the capability id,
shows `secretSave` in its `aliases`, and an exact-name search for `secretSave`
finds `secretSet`. The `scope`
values are `user` (default) and `package`; `session` is rejected because celld
does not support session-scoped secrets. `packageName` is a celld extension,
normally inferred from the calling package.

`secretSetMany` validates every entry and quota before writing, then saves the
batch atomically. Set `assertOnly: true` to validate a batch without storing
values. The `expires_at` field is accepted by `secretSet` and `secretSetMany`,
but celld supports only null or omission, meaning no expiry. The hosted fields
`provider`, `inject`, `placement`, `kind`, `hosts`, and `login_exchange` are
also supported only at their celld defaults. Omit or pass null for `provider`
and `login_exchange`; omit or pass null for `hosts` to use the account's
approved secret hosts; use `kind: 'secret'`; use the default Authorization
bearer header injection `{ kind: 'header', name: 'Authorization', format:
'Bearer {value}' }` (the name is case-insensitive); and use null or
`{ headers: true, query: true, path: true, body: true }` placement for
injection anywhere. Other values fail with `unsupported_secret_field` before
any write, including in `secretSetMany` and `assertOnly` calls.

Values are AES-256-GCM encrypted with a fresh 12-byte IV under a per-user key:
`HKDF(master = KODY_MASTER_KEY, salt = "kody-celld:<userId>", info = "kody-celld-secret-values")`.
Ciphertext lives in the user's `UserCell` together with a 16-hex-char
`key_id` (a hash of the sealing master key, so rows can be matched to a key
without revealing it); the master key lives only in the Worker var.
`secretSet` responses and run results are checked by the smoke suite to never
contain the plaintext.

## Master key rotation

Rotation is a three-step, zero-downtime process:

1. Generate a new key and deploy with **both**:
   `KODY_MASTER_KEY=<new>` and `KODY_MASTER_KEY_PREVIOUS=<old>` (comma-separate
   several retired keys if needed). New writes use the new key; reads pick the
   key by `key_id`, so nothing breaks in between.
2. Re-seal everything:
   ```sh
   curl -X POST $BASE/admin/secrets/rekey -H "authorization: Bearer $KODY_ADMIN_TOKEN"
   # -> { currentKeyId, resealed, remaining, users: [...], next: "..." }
   ```
   It walks every user cell and re-encrypts rows whose `key_id` differs from
   the current key. Rows it cannot decrypt are left in place, counted in
   `remaining`, and logged by name (never value).
   `POST /admin/secrets/rekey` also re-seals MCP server bearer tokens.
3. When `remaining` is `0`, remove `KODY_MASTER_KEY_PREVIOUS` and redeploy.

Docker single-node: set both variables in `.env`, `docker compose up -d`, run
step 2, then remove `KODY_MASTER_KEY_PREVIOUS` from `.env`. The container
writes the new `KODY_MASTER_KEY` back into `/data/kody.env`, so it stays in
effect even if you later drop it from `.env`. Fleet: set both in `.env` and
`docker compose run --rm deploy` for steps 1 and 3.

The whole cycle is exercised by `smoke/rekey.mjs` in three phases around node
restarts (`seal` → restart with both keys → `rotate` → restart with the new
key only → `verify`); it proves a secret sealed under the old key still
injects at every step and that `rekey` becomes a no-op at the end.

## Placeholders

| Form                                     | Replaced with                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `{{secret:name}}`                        | the value                                                                                    |
| `{{secret:name\|scope=package}}`         | the value, only if the package-scoped secret belongs to the running package                  |
| `{{secret-basic:username=u,password=p}}` | `Basic base64(u_value:p_value)`; a leading `Basic ` in the header is collapsed               |
| `{{integration-token:name}}`             | the OAuth access token of a connected integration ([integrations.md](./integrations.md))     |
| `{{secret/provider:ref}}`                | a value fetched from a bound provider package ([secret-providers.md](./secret-providers.md)) |

Placeholders are recognised in the URL (path, query, also URL-encoded
`%7B%7B…%7D%7D`), any header, and the request body (string/JSON bodies).

## The gateway decision

Every outbound `fetch` from an isolate is routed through `FetchGateway`
(`globalOutbound`). For requests containing placeholders:

```
admin surface?          → 403 admin_surface_blocked
not https (and host not in KODY_PRIVATE_HOSTS)? → 403 insecure_scheme
{{secret:…}} and host not approved? → 403 secret_host_not_approved  { approvalUrl }
secret missing?         → 404 secret_not_found          { missing }
{{integration-token:…}} → integration checks (allowedHosts, usage, refresh) — integrations.md
{{secret/…}}            → provider checks (binding, grant, sealed run, item hosts) — secret-providers.md
otherwise               → replace, forward, record 'injected'
```

A value that is not a valid header value (for example one with a newline) is
refused with `400 secret_invalid_header_value` rather than sent.

### Redirects

The gateway follows redirects itself; `fetch` never does. Each redirect target
gets the whole decision above again (admin surface, transport, host approval,
integration and provider host lists) and its own `gateway[]` entry with
`redirect: n`. Fetch's own rules apply first: 301/302 turn POST into GET, 303
turns everything but HEAD into GET (dropping the body), and `authorization`,
`proxy-authorization` and `cookie` stay on their origin. When a target fails
the decision, headers that carried a placeholder are dropped (reason
`placeholder_headers_dropped:<code>`); if the URL or body still references a
secret the hop is denied instead. After at most 20 redirects the gateway
answers `502 redirect_limit_exceeded`. The sandbox sees the real `res.url` and
`res.redirected`; `redirect: 'manual'` returns the 3xx untouched and
`redirect: 'error'` rejects.

### Body encoding

In a body sent as JSON (`application/json`, `application/*+json`,
`application/x-ndjson`) each value is JSON-string-escaped, so a placeholder
belongs inside a JSON string, which is where `JSON.stringify` puts it. Other
bodies (text, form-encoded, multipart) get the raw value, so encode for the
format yourself.

Denials are synthetic `Response`s returned to the sandbox with a JSON body;
the request never leaves the node. Requests **without** placeholders are
forwarded untouched (`outcome: 'forwarded'`) — the gateway is not an egress
firewall. Every decision is recorded on the run (`gateway[]`) with host,
outcome, status, reason and the secret **names** involved.

## Approving hosts

```sh
curl -X POST $BASE/admin/users/$USER_ID/secret-hosts \
  -H "authorization: Bearer $KODY_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"api.github.com"}'
curl $BASE/admin/users/$USER_ID/secret-hosts -H "authorization: Bearer $KODY_ADMIN_TOKEN"
curl -X DELETE $BASE/admin/users/$USER_ID/secret-hosts/api.github.com -H "authorization: Bearer $KODY_ADMIN_TOKEN"
```

Hosts are normalised (lowercase, no port), IPv6 literals are bracketed, and
`*.example.com` approves exactly one label depth. An account admin can manage
the list, and a signed-in owner can approve hosts included in a
`/connect/secret-set` link. That link uses the existing per-user host list, not
a per-secret allowlist. The denial message includes the `approvalUrl` so an
agent can ask a human precisely.

## Owner-entered setup links

An agent can send an owner a `/connect/secret-set` link with the secret name,
description, scope, and hosts to approve. The owner signs in, pastes the value
in the browser, and celld saves it without returning the value to the agent.
`expiresAt` and `allowedPackages` are shown as unsupported and are not saved.

## Development

`KODY_PRIVATE_HOSTS=127.0.0.1,localhost,host.docker.internal` (in
`.dev.vars.example` for local `celld dev` / smoke) lets the smoke suite inject
into a plain-HTTP loopback echo server. The same list is the operator's
private-host allowlist for MCP servers, the browser and package sources, and
plain-`http:` secret fetches are allowed only to hosts on it, so list only
hosts you trust to receive secrets without TLS.

## Current limitations

- Per-secret host allowlists for `{{secret:…}}` (approval is per host, per
  user; integration tokens and provider items carry their own host lists).
- Egress allowlisting for placeholder-free requests.
