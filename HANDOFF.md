HANDOFF: BLOCKED the Docker and browser gates need a quiet machine, and three other lanes are driving this one

Task 096 is implemented and reviewed-ready at PR #1379. Nothing is half-written: every
change is committed, the templates are synced, the ledger row reads done and the changeset
is in place. What is missing is gate evidence, not work.

## What is green

- `pnpm verify`'s whole non-test half, at this head: typecheck, lint, Prettier, the 26
  `check:all` scripts, `sync-templates --check`, `generate-prompts --check`,
  `check-agent-step-args` and `check-comments`.
- Every test suite outside `qcms-api`: `@roonga/qcms-core` 774, `@roonga/qcms-db` 570,
  `@roonga/qcms-a2ui-compiler` 110, `@roonga/qcms-ui` 803, `create-qcms-app`,
  `qcms-portal` 904, `qcms-admin` 2826. All passed in the forced run and in verify.
- `qcms-api`: 3366 of 3376 passed, the remainder skipped behind one container that could
  not start. This task's own suites passed every run: `parity.test.ts` (81),
  `propose.test.ts` (93), `provenance.integration.test.ts` (36, including the new
  suspended-Confirm case), `actions.integration.test.ts`, `builder.integration.test.ts`,
  `edit.integration.test.ts`, `assist.integration.test.ts`.

## Why the gates are blocked

Three other lanes are running on this machine: `src/qcms-095`, `src/qcms-099` and
`src/qcms-100r2`. Seat 1's browser harness is listening on 17100, 17110, 17130 and 17140,
and lane 099 is running Next dev servers, Playwright and a dozen test Postgres containers.
The host sat at a load average of 38 to 46 over 24 CPUs.

Under that load four full runs each failed on a different pre-existing test, none of them
in this diff:

- `forms.integration.test.ts > workspace pin gate > refuses a new pin to another
workspace's question, grandfathers a carried one, and allows the library`: timed out at
  the 5000 ms default, and passes in 439 ms on its own. Its cleanup is in a `finally` that
  a timeout abort skips, so it leaves a second active workspace behind and two later tests
  then read 400 instead of 201.
- `membership.integration.test.ts > the self-grant rule > holds one of a concurrent join
and a response-role edit of the same group`: ten attempts, each a group create plus two
  lock-contended concurrent requests, inside the same 5000 ms.
- `submit.integration.test.ts > required-answer sweep > a RETRACTED required answer blocks
submit exactly like a never-answered one`: five sequential container-backed requests
  inside the same 5000 ms.
- `auth.integration.test.ts`: the test Postgres container did not bind port 36010 within
  210000 ms. The harness printed the cause itself (issue #812): "load 44.25/48.85/43.21
  over 24 cpus, docker 21 running".

The shape is systemic rather than per-test. In `vitest.config.ts` only the `qcms-api-e2e`
and `create-qcms-app-e2e` projects raise `testTimeout` to 120000; the `qcms-api` project
takes Vitest's 5000 ms default, and its `src/**/*.integration.test.ts` files all do real
container-backed HTTP work. `edit.integration.test.ts` is the one that opts out, with
`{ timeout: 60_000 }` on its describe. Raising the project's own timeout is the fix, and it
belongs with issue #604 and issue #1309 rather than inside this task: it is a cross-slice
change to how every gate behaves.

## What is left

1. On a quiet machine, `pnpm verify` with `QCMS_PORT_SEAT` unset.
2. `pnpm exec turbo run test --force`, confirming 0 cached.
3. `rm -rf apps/admin/.next-dev apps/portal/.next-dev`.
4. `QCMS_PORT_SEAT=8 pnpm verify:browser:detached`, then `pnpm verify:browser:wait <dir>`
   in slices while it exits 75, reading the real code from the `.rc` file. The exit
   criterion is `agent-cards-*.pw.ts`, and `agent-cards-workspace.pw.ts` carries this
   task's new held-card test. Start it only once no harness is listening on 17100-17999
   outside seat 8; seat 1 was live when this was written.
5. Delete this file.
