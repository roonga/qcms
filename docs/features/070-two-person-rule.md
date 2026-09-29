# 070 - The two-person rule for production

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api` (the check at release and at a `prod` endpoint change), `@roonga/qcms-db` (the approval on the release row), `apps/admin` (the approval flow and the workspace setting) · **Depends on:** 065, **067** and 069. 067 creates the `prod` webhook endpoint route and its role check, and this task adds the propose, pending and confirm mechanism on top of it (067's criterion 8a, moved here by Q51)
**References:** ADR-41 (the release rule and the `forms.approver` role) · ADR-40 (the release record the approval is written on) · SEC-14 (the per-environment egress allowlist underneath) · SEC-15 · `plan/environments-and-workspaces.md` the 070 section of 8, and Q13, Q30, Q32, Q34, Q38, Q51 and finding 5 · issue #995 · issue #998

## Context

A release to `prod` and a change to a `prod` webhook endpoint are the two acts in this design that can put production personal data somewhere new. **One per-workspace switch governs both** (Q30), which is why this is one task and not two, and it gates **`prod` alone**: a release to `dev` or `test` is self-service for an editor holding that environment in scope, which is what keeps a test cycle usable (finding 5).

The switch is **off by default**, including on the workspace a fresh database is seeded with (Q13). That default is deliberate rather than lax: an installation with one administrator cannot satisfy the rule at all, so defaulting it on would mean a bootstrapped deployment could not release to `prod` until a second account existed, and the first thing an operator would learn about the feature is how to turn it off.

## The rulings that govern this task

Q13 (off by default, per workspace, including on the seeded workspace), Q30 (one switch governs both the `prod` release and the `prod` endpoint change, and both need `forms.approver` with `prod` in scope), **Q51 (the two mechanisms, and "author" meaning the account that published the version)**, Q32 (the switch is the workspace row's `requireSecondApprover` typed additional field), Q34 (**`forms.owner` does not approve**; ADR-41's earlier "approver or owner" line is corrected to approver only), Q38 (`forms.viewer` can neither release nor approve), finding 5 (approver-not-author gates the release to `prod` only). ADR-41's release rule binds it; ADR-40's release record is where the approval is written.

## Deliverables

- **The per-workspace setting**, on the workspace's **`requireSecondApprover`** additional field (Q32), defaulting **off**. Task 068 added the field; this task is what reads it.
- **The release mechanism, which is one act** (Q51). A release to `prod` is **refused when the releasing account is the account that published that version**, and succeeds for a different `forms.approver` holding `prod` in scope. It applies at release to `prod` and at no other release, so a release to `dev` or `test` stays self-service for an editor holding that environment in scope.
- **The endpoint mechanism, which is two acts** (Q51, carrying 067's criterion 8a). A `prod` webhook endpoint change is **proposed by one account and stored pending**, takes effect on nothing until it is confirmed, is **refused when the confirming account is the proposing one**, and **applies when a different `forms.approver` holding `prod` in scope confirms it**. One switch governs both mechanisms (Q30), which is why this is one task and not two. SEC-14's per-environment egress allowlist stays the network backstop underneath, because an endpoint that should not have been set is still an endpoint a firewall can refuse.
- **"Author" means the account that published the version** (Q51, as ADR-41 already says), so a draft several editors touched has exactly one author and the check compares two accounts rather than two roles.
- **The approver must hold the `forms.approver` role with `prod` in scope, and a `forms.owner` does not qualify** (Q34). An owner who should approve is given a `forms.approver` grant, which makes their authority **a row somebody can read** rather than a rank. One person may hold `forms.editor` and `forms.approver` grants together, so the rule is about **two accounts** rather than two kinds of person.
- **The approval recorded on the ADR-40 release record**, which is what makes it auditable rather than procedural, and readable in the release history.
- **The admin flow that asks for it**, on the release path and on the `prod` endpoint path.

## Exit criteria

Exit criteria **1 to 7** of the 070 section of `plan/environments-and-workspaces.md` section 8. This task owns those and no others. **Criterion 7 is task 067's criterion 8a, moved here by Q51**, the way Q44 moved 4b to 069: with the setting on, a `prod` endpoint change proposed by one account is stored **pending**, a confirmation by the **same** account is refused, a confirmation by a **different `forms.approver`** holding `prod` in scope applies it, and with the setting off the change applies at once as 067 builds it.

Criterion 1 turns on Q51's definition of author: the account that **published** the version, not whoever last edited the draft.

Criterion 5 is the one that walks the refusals: a `forms.approver` from another workspace is refused, so is one in the right workspace who does not hold `prod`, so is a `forms.owner` who holds no `forms.approver` grant (Q34), and so is a `forms.viewer`, which cannot release or approve at all (Q38). Criterion 6 adds the installation claim: an administrator holding it but no membership cannot approve, and cannot approve their own release.

## Files and areas

The release route and the `prod` endpoint route in `apps/api/src/features/` (067 creates the second; this task adds the pending state and the confirm step to it), the approval column on `form_releases` and the pending-endpoint state in `packages/db/src/schema/` and their reads in `packages/db/src/queries/`, the workspace setting's read path, the admin's release and approval flow, the pending-endpoint confirmation screen and the workspace settings screen, the admin i18n catalog, and a changeset.

## Gates

`pnpm verify` and `QCMS_PORT_SEAT=<0-9> pnpm verify:browser`, **required and not conditional** because this task changes `apps/admin` (`CONTRIBUTING.md`), run detached with `pnpm verify:browser:detached` and then `pnpm verify:browser:wait <dir>` in slices until it stops exiting 75, never in the foreground (issue #846). Add the forced Docker-backed run if the pending-endpoint state lands as a migration, and run it in sequence with the browser suite rather than concurrently (issue #863).

## Out of scope (binding)

The release record and the release path itself (065). The `prod` endpoint configuration, its route and the `forms.approver` role check on it (067): this task adds the pending state and the second account, and builds neither the route nor the role check. The roles, the scope, the grant write path and the audit (069). Extending the rule to any environment other than `prod`: it is narrowed deliberately, for the same reason a `dev` endpoint change is not gated, because a `dev` endpoint routes test data to a test consumer and gating it would cost a test cycle and protect nothing. Defaulting the switch on. A second switch for endpoints: Q30 says one, and Q51 says the one switch drives two mechanisms.

## The item this task used to wait on, now ruled

**Issue #998 item 6 is ruled** (Q51, Code Owner, 2026-09-29). It asked whether the two-person rule has one mechanism or two, and what "author" means when several editors touched a draft. The answer is **two mechanisms, stated above**, and **author is the account that published the version**.

Nothing in this task is parked and nothing in it is a question for the executor. If a case arises that Q51 does not reach, the executor parks the branch with a committed `HANDOFF.md` whose first line reads `HANDOFF: AWAITING-HUMAN` and reports it, rather than choosing.

## Notes for the executor

**Criterion 3 is the one that protects the default.** With the setting off, which is the default, behaviour matches 065 exactly and a single-administrator installation can release to `prod`. An implementation that asks for an approver and then accepts the same account has changed the default's behaviour while appearing to keep it.

**Two accounts, not two kinds of person.** One person may hold `forms.editor` and `forms.approver` together, so the check is on the account that published the version against the account approving the release, and never on which roles that person holds. The endpoint mechanism reads the same way: the proposing account against the confirming one.

**The two mechanisms are different shapes and the difference is deliberate** (Q51). A release names a version that already exists and can be judged in one look, so it is one act. An endpoint change is a new value somebody has to read before it is live, so it is proposed, held pending and confirmed. Do not collapse them into one mechanism for symmetry: that is the question issue #998 raised and the Code Owner answered the other way.

**The approval is a row, not a UI step.** Criterion 2 asks that it is on the release row and readable in the history. A flow that confirms in the admin and records nothing satisfies the screen and fails the audit the rule exists for.
