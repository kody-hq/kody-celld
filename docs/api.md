# HTTP API

celld serves its hosted-compatible HTTP API at the origin of `KODY_PUBLIC_URL`,
not on a separate `api.` host. `GET /openapi.json` lists that origin in its
`servers` array. Send a Bearer token with each `/v1` request: `kc_` API tokens
and `mcpat_` OAuth access tokens are accepted.

`GET /openapi.json` is public and describes the operations enabled by the
capabilities registered in this celld build. `GET /v1/search` searches the
capability and package catalog. `POST /v1/execute` accepts exactly one of
`code` or `invoke` and returns the same execute envelope as MCP. `invoke` uses a
`kody:@scope/package/export` specifier. `conversationId` and `memoryContext`
are accepted but unused; `credentials` is not supported:

The route table includes packages, runs, jobs, memories, MCP server
instructions, secrets, webhooks, email, integrations, MCP servers, community,
and storage. Routes appear in OpenAPI only when their capability is registered
in that celld build.

```json
{
  "code": "export default async function main() { return 42 }",
  "params": {}
}
```

Other routes invoke the corresponding capability and return its raw result.
See `/openapi.json` for the routes available in the running deployment.

## Legacy capability API

`POST /api/call/:capability` and `GET /api/capabilities` are deprecated and
will be removed in v0.3.0. Their responses carry a `Deprecation` header (RFC 9745) and `Link: <https://github.com/kody-hq/kody-celld/blob/main/docs/api.md>;
rel="deprecation"`. Move callers to the `/v1` route for the same capability
(listed in `/openapi.json` by `operationId`), and use `GET /openapi.json`
instead of `GET /api/capabilities`. `/v1` returns the raw capability result
instead of the `{ ok, result }` envelope, and errors as
`{ error: { code, message } }`. `/api/blobs/*` and `GET /api/webhooks/:handle/url`
are not part of this deprecation.
