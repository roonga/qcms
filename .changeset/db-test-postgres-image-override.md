---
"@qcms/db": minor
---

The `./testing` harness no longer hardcodes the Postgres image it boots.
`QCMS_TEST_POSTGRES_IMAGE` (read once, at module load) overrides
`postgres:16-alpine`, so a consumer whose CI cannot rely on anonymous Docker Hub
pulls can point the harness at a mirror of the same image; the default is
unchanged, so a local `pnpm test` needs no configuration. `startTestDb` also
accepts `{ image }` for callers that need a one-off reference, and
`DEFAULT_TEST_POSTGRES_IMAGE` is exported alongside the resolved
`TEST_POSTGRES_IMAGE`.

When the container cannot start, `startTestDb` now throws an error naming the
image, whether the failure was a registry pull, the underlying Docker error (kept
as `cause`), and the override to reach for. Previously a failed pull surfaced only
Docker's opaque `(HTTP code 500) server error - Get "https://registry-1.docker.io/v2/"`
from inside `beforeAll`, and every `afterAll` then reported
`Cannot read properties of undefined (reading 'teardown')` instead. A reference
that has already failed to pull in the same worker fails immediately rather than
waiting on the registry again.
