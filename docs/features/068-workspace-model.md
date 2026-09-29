# 068 - Workspaces on the organisation table: ownership, moving and archiving

**Stage:** 9 (Phase 4) · **Apps/packages:** `@roonga/qcms-db` (the workspace reference and the slug constraint), `apps/api` (the workspace routes, the pin rule and the seeding) · **Depends on:** built now, ahead of 038 (launch validation) by the Code Owner's direction of 2026-09-29; independent of track A. The plan's original dependency text read "Depends on 038"
**References:** ADR-41 (the decision) · ADR-40 (the `control` schema the row lives in) · ADR-04 (single tenancy, which this does not change) · ADR-02 (question versions and pinning) · ADR-17 (two whole-session delete paths, and no third) · ADR-06 (better-auth) · `docs/auth-swap.md` · `plan/environments-and-workspaces.md` the 068 section of 8, and Q13, Q14, Q15, Q22, Q32 and finding 10 · R6 · R7 · issue #179 · issue #995

## Context

Every authenticated administrator sees the whole library today: `user.role` carries `admin` for everyone and nothing reads it for an authorization decision (SEC-3, issue #179). There is no way for two groups inside one organisation to share an installation without seeing each other's forms and questions.

ADR-41 answers that with a **workspace**: an authorisation grouping, not tenancy. One operator, one configuration, one identity store, one database, one deployment, with authorisation **between** workspaces rather than isolation guarantees. Multi-tenancy stays out (R7, ADR-04) and this does not make that decision partly true.

This task builds the **model**: the row, what it owns, how a question moves between workspaces and how a workspace is archived. The roles, the scope, the names and the audit are task 069's.

**The mechanism is ruled** (Q32): a workspace is **better-auth's `organization` row** carrying `isShared`, `requireSecondApprover` and `archivedAt` as typed additional fields, rather than a `workspaces` table of QCMS's own. The evaluation recommended QCMS tables; the Code Owner weighed reuse across applications above the coupling, and `docs/auth-swap.md` and the risk row in `CONTRIBUTING.md` now say that leaving better-auth would mean migrating authorisation too.

**The Code Owner's direction of 2026-09-29** is that the environments and workspaces work starts now, so 064 to 070 may be dispatched ahead of task 038. That is a dispatch direction: the Phase 4 classification is unchanged and this task does not gate launch.

## The rulings that govern this task

Q13 (the two-person switch is off by default, including on the seeded workspace), Q14 (a question may move between workspaces, with existing pins grandfathered and new pins gated), Q15 (a workspace is archived, never deleted), Q22 (green field, so the slug constraint is a plain constraint and not a data fix), Q32 (the row is the plugin's `organization` row, and `forms.owner` is the member row's role), finding 10 (the shared workspace is the org-wide library and its asymmetry is the design). ADR-41 binds it.

## Deliverables

- **The workspace as better-auth's `organization` row** (Q32), carrying **`isShared`**, **`requireSecondApprover`** and **`archivedAt`** as typed additional fields. **Task 064 carries the plugin's five tables and the mirror** in its baseline migration, so this task finds them there; the tracks are independent, so **if this task lands first it adds them itself** and 064 finds them instead.
- **The workspace reference on `forms` and `questions`**, so a form or question cannot exist without exactly one workspace, enforced by the column rather than by a backfill.
- **The shared workspace and the publish-time pin rule.** Every workspace's editors **see and may pin** the shared workspace's questions; **only the shared workspace's own members edit them** (finding 10). That asymmetry is what makes it a library rather than a place three groups overwrite each other's wording. The question's text is the one thing that crosses a workspace boundary, and no response ever does.
- **Moving a question between workspaces** (Q14), which is one `UPDATE` on the identity row and touches no version. Forms elsewhere that already pin one of its versions **keep serving and keep that pin in their next draft** (ADR-02, R6); a **new** pin from another workspace onto a question outside the shared workspace is **refused through the same path that refuses a pin to a `deprecated` version**, so authors meet one mechanism rather than two.
- **Archiving a workspace, never deleting one** (Q15). Archiving requires **no open form and no released version**, and the workspace's forms and questions are **reassigned first**, so it is the last step rather than a cascade. **No response row is ever reached**, which keeps ADR-17's whole-session delete doors at two.
- **The unique constraint on `forms.slug`** that does not exist today. Slugs stay unique **installation-wide**, which green field makes a plain constraint rather than a data fix.
- **The seeding of a first workspace**, so a bootstrapped installation has one to author in, with the two-person switch **off** on it (Q13). The seeding uses the server-side **`createOrganization` with `userId`** rather than the request-scoped call, because the seeded workspace is created before anybody is signed in and the session-based form has no user to attribute it to.
- **The slug uniqueness and shared-workspace rules as QCMS domain rules**, enforced in QCMS code. They are unchanged by the table's owner moving.

## Exit criteria

Exit criteria **1 to 7** of the 068 section of `plan/environments-and-workspaces.md` section 8. This task owns those and no others. **The per-workspace reporting split is not among them**: 069 depends on this task and 067 depends on 069, so 067 always lands after it, and 067 builds the split and asserts its own criterion 7.

Criterion 5 is asserted rather than reasoned: **no code path deletes a workspace, and none reaches a response row from one.** Criterion 6 is asserted on **both halves**: an editor outside the shared workspace can read and pin a shared question and **cannot edit one**.

## Files and areas

`packages/db/src/schema/auth.ts` (the organisation's additional fields, and the plugin's five tables if this task lands before 064), `packages/db/src/schema/forms.ts` and `questions.ts` (the workspace reference and the slug constraint), `packages/db/src/queries/forms.ts` and `questions.ts`, the workspace routes and the pin rule in `apps/api/src/features/`, the better-auth instance configuration in `apps/api/src/features/auth/instance.ts`, the bootstrap seeding, `docs/auth-swap.md`, `CONTRIBUTING.md`'s risk row, and a changeset.

## Gates

`pnpm verify` and the forced Docker-backed run (`pnpm exec turbo run test --force`, confirmed to have executed rather than served cached output), because the slug constraint, the archive refusal and the erasure-path assertion are proved against a real Postgres. **No browser gate, because this task touches no browser surface.** If that changes, `CONTRIBUTING.md` makes `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` required rather than optional and a Playwright spec required with it, run detached (issue #846) and in sequence with the forced run (issue #863).

## Out of scope (binding)

The six roles, the scope, the access-group names, the resolver, the middleware, the grant write path and the SEC-15 audit (069): this task builds the **container** and grants nothing. **The per-workspace reporting split (067)**: 067 always lands after this task, so the split is its deliverable and its criterion, and this task neither builds it nor asserts it. **Any admin surface for workspaces**: the plan's 068 section has no screen in it, and a screen this work order invented would be a requirement the plan does not have. The admin's workspace and membership screens arrive with 069, which is where the permissions matrix that governs them is built. The two-person rule's check (070): this task adds `requireSecondApprover` as a field, defaulting off, and nothing reads it. Everything in track A (064 to 067): the tracks are independent and this task depends on none of them, beyond finding or creating the plugin tables. The per-workspace reporting view split, which is 067's deliverable and lands when this task does. Deleting a workspace, in any form. A workspace segment in any URL. Per-workspace configuration, theming or ports. Multi-tenancy (R7, ADR-04).

## Notes for the executor

**Archiving is the last step and never a cascade.** Criterion 4 refuses an archive while an open form or a released version remains, and succeeds once they are reassigned. An implementation that reassigns or closes on the operator's behalf turns one act into several silent ones and fails the spirit of Q15 even where it passes the letter.

**The grandfathering in Q14 is two properties, not one.** A form elsewhere that already pins a moved question keeps serving **and** keeps that pin in its next draft. The second half is the one an implementation drops, because the draft is where the refusal lives.

**If you land before 064, you own the plugin tables.** Add `organization`, `member`, `invitation`, `team` and `teamMember`, the two session columns and every declared additional field to the hand-kept mirror in `packages/db/src/schema/auth.ts` as an ordinary appended migration, and say so in the PR so 064's baseline carries them rather than re-creating them. better-auth's startup check runs in both directions, so a column it declares that the mirror lacks is fatal on the first request through its handler.
