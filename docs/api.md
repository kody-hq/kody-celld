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

```json
{
  "code": "export default async function main() { return 42 }",
  "params": {}
}
```

Other routes invoke the corresponding capability and return its raw result.
See `/openapi.json` for the routes available in the running deployment.
