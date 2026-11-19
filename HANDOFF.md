HANDOFF: AWAITING-HUMAN rule on how 096's subject check sits beside the one task 115 just landed, then run the gates on a quiet machine

Task 096 is implemented at PR #1379 and nothing is half-written: every change is committed,
the templates are synced, the ledger row reads done and the changeset is in place. Two
things stop it being finishable from inside this lane.

## 1. Task 115 landed an overlapping subject check (the decision)

PR #1360 (task 115) merged to `main` while this branch was in flight and added its own
`subjectRefusal` to `apps/api/src/features/agent/tools/propose.ts`, over the same seam:

- `draftWriteRefusal`, the draft-save form's `form: write`, through the `canWriteDraft` port.
- `formCreateRefusal`, the workspace a `form.create` names, through the same port.
- `takenQuestionIdRefusal`, R6's used-id check.

This branch generalises the same idea: one `subjectAllows` port asked for **every** kind,
with that kind's whole cell set, in the environment the step binds, on the workspace the
subject belongs to. It subsumes both of 115's first two checks.

Merging `main` conflicts in three files on exactly that function:
`apps/api/src/features/agent/tools/propose.ts`, its test, and the scaffold mirror. The merge
was aborted rather than resolved, so this branch is still exactly what was pushed.

Two ways to resolve, and the choice is a call on freshly reviewed code rather than a
mechanical fix:

- **Subsume.** Drop `canWriteDraft`, `draftWriteRefusal` and `formCreateRefusal`, and let the
  generic check cover them. Cleaner, one port, no duplication. It rewrites code task 115 had
  reviewed days ago and changes the two refusal messages its tests assert.
- **Sit beside.** Keep 115's port and both specific refusals untouched, and run the generic
  check after them. 115's tests pass unchanged and both properties hold, but the two specific
  checks become unreachable in practice and a reviewer will read that as duplication.

Recommended: subsume, since the generic check is the audit 096 was asked for and two ports
asking the same question is the drift this task exists to remove. It needs the Code Owner's
or the conductor's agreement because it edits task 115's merged work.

Whichever way it goes, the merge also has to keep everything else 115 added here, including
`screenDefaults` and `CREATE_FORM_KIND`.

## 2. The gates need a quiet machine

Three other lanes are running on this host: `src/qcms-095`, `src/qcms-099` and
`src/qcms-100r2`. Seat 1's browser harness was listening on 17100, 17110, 17130 and 17140,
and lane 099 was running Next dev servers, Playwright and a dozen test Postgres containers.
The host sat at a load average of 38 to 46 over 24 CPUs, so the browser gate was never
started: the work order allows it only when no other seat's harness is live.

Under that load four full runs each failed on a different pre-existing test, none in this
diff:

- `forms.integration.test.ts > workspace pin gate > refuses a new pin to another
workspace's question, grandfathers a carried one, and allows the library`: timed out at
  the 5000 ms default, and passes in 439 ms on its own. Its cleanup is in a `finally` a
  timeout abort skips, so it leaves a second active workspace behind and two later tests
  then read 400 instead of 201.
- `membership.integration.test.ts > the self-grant rule > holds one of a concurrent join
and a response-role edit of the same group`: ten attempts, each a group create plus two
  lock-contended concurrent requests, inside the same 5000 ms.
- `submit.integration.test.ts > required-answer sweep > a RETRACTED required answer blocks
submit exactly like a never-answered one`: five sequential container-backed requests
  inside the same 5000 ms.
- `auth.integration.test.ts`: the test Postgres container did not bind port 36010 within
  210000 ms, and the harness printed the cause itself (issue #812).

The shape is systemic. In `vitest.config.ts` only `qcms-api-e2e` and `create-qcms-app-e2e`
raise `testTimeout` to 120000; the `qcms-api` project takes Vitest's 5000 ms default while
its `src/**/*.integration.test.ts` files all do container-backed HTTP work.
`edit.integration.test.ts` is the one that opts out, with `{ timeout: 60_000 }` on its
describe. Raising the project's own timeout belongs with issue #604 and issue #1309 rather
than inside this task.

## What is green at this head

- `pnpm verify`'s whole non-test half: typecheck, lint, Prettier, the 26 `check:all`
  scripts, `sync-templates --check`, `generate-prompts --check`, `check-agent-step-args`
  and `check-comments`.
- Every suite outside `qcms-api`: core 774, db 570, compiler 110, ui 803, portal 904,
  admin 2826, plus `create-qcms-app`. `qcms-api` 3366 of 3376, the rest skipped behind the
  one container that would not start.
- This task's own suites, every run: `parity.test.ts` 81, `propose.test.ts` 93,
  `provenance.integration.test.ts` 36 including the new suspended-Confirm case, and the
  agent builder, edit, actions and assist integration suites.

## What is left

1. Settle section 1 and merge `origin/main` accordingly.
2. `pnpm verify` with `QCMS_PORT_SEAT` unset.
3. `pnpm exec turbo run test --force`, confirming 0 cached.
4. `rm -rf apps/admin/.next-dev apps/portal/.next-dev`.
5. `QCMS_PORT_SEAT=8 pnpm verify:browser:detached`, then `pnpm verify:browser:wait <dir>`
   in slices while it exits 75, reading the real code from the `.rc` file. The exit
   criterion is `agent-cards-*.pw.ts`, and `agent-cards-workspace.pw.ts` carries this
   task's new held-card test.
6. Delete this file.
