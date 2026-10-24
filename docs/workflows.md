# Workflows

Workflows queue durable background runs in the caller's user cell. Create one
from package code with `workflows.create()` or call the host capability
`packageWorkflowCreate` directly.

```ts
import { workflows } from 'kody:runtime'

export default async function main() {
  return await workflows.create({
    exportName: './reports/daily',
    workflowName: 'daily-report',
    params: { date: '2030-01-01' },
    idempotencyKey: 'daily-report-2030-01-01',
  })
}
```

An export name uses the current package context. Outside a package run, include
`packageId`. Inline workflows provide `code` instead of `exportName`:

```ts
await workflows.create({ code: 'export default async ({ date }) => ({ date })', params: { date: '2030-01-01' } })
```

Exactly one of `code` and `exportName` is required. `workflowName` defaults to
the export name or `inline-code`; `runAt` defaults to now. `params` must be a
JSON object. Reusing an `idempotencyKey` for the same user and source returns
the existing workflow, including when it is already terminal. Without a key,
each call creates a new workflow. At most 25 queued or running workflows may
exist per user.

`workflowRunList({ limit })` returns up to 100 recent workflows, default 25.
`workflowRunCancel({ id })` cancels queued work. A running attempt is not
interrupted, but its result is discarded and no retry is scheduled.

The one-minute cron dispatches due workflows. Each attempt creates its own run
record, uses the five-minute background timeout, and retries failures up to
four total attempts with 30-second exponential backoff. Cron precision is
approximately one minute.

Celld accepts package `sourceRevision: 'latest'`; pinned revisions are not
supported. The account Workflows page is not included in this backend change.
