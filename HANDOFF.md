HANDOFF: INTERRUPTED

Every deliverable is implemented, committed and pushed, and PR #1417 is open. What is left is
one clean run of two gates, after the last commit.

## What remains

- `pnpm verify`. The last full run (`verify-d`) had one real failure, now fixed and re-run in
  isolation green (`forms.integration.test.ts`, the publish refusal read from `error.details`),
  plus two host-contention failures that are not this branch's: `outbox.integration.test.ts`
  (ECONNREFUSED) and `site-admins.integration.test.ts` (test Postgres container not bound in
  210s), both with the issue #812 contention report attached and the host at load 10 over
  24 cpus with two other seats' stacks up. Re-run on a quiet host.
- `QCMS_PORT_SEAT=<free seat> pnpm verify:browser`, detached. The run that was in flight
  started before the last commit, so its verdict does not cover it.
- CI on #1417 showed `browser-e2e` shards 2, 3 and 5 red for one cause: under `next dev` the
  dev server's own indicator sits bottom inline-start, which is where this branch moves the
  assistant composer, and it intercepted the click on Send. `apps/admin/next.config.ts` now
  moves that indicator to `top-right`. Re-run the shards to confirm.

## Known local fails to ignore

`reflow.pw.ts` and `two-person-rule.pw.ts` (issue #1387).

## Not done, deliberately

- Share preview is unchanged. Work order 113 and `plan/agent-builder-decisions.md` Q12 define it
  as "the authenticated admin preview route. No public preview links.", which is what
  `sharePreviewHref` already does. Nothing in work orders 106 to 121 gives it any other
  behaviour, so there was nothing to make it match.
- The preview-only pin exception is recorded as a Note on ADR-02 with siblings in
  `docs/SECURITY_DESIGN.md`, `docs/ARCHITECTURE.md` and `docs/DOMAIN_SCHEMA.md`. Whether it
  wants a numbered ADR instead is a Code Owner decision and is flagged in the PR body, not
  taken.
