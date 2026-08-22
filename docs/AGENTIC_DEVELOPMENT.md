# QCMS agent workflow

This document defines how agent-led work is planned, implemented, reviewed, and merged. See `docs/DEVELOPER_GUIDE.md` for operator commands.

## Operating model

- The Code Owner makes ADR, scope, security acceptance, destructive-operation, and explicit human-gate decisions.
- One root conductor selects work, plans, delegates, handles PR state, and serializes merges.
- Executor subagents implement isolated tasks or issues in separate worktrees.
- Reviewer subagents independently review an exact PR head and never edit it.
- Repository documents, branches, PRs, `HANDOFF.md`, and the ledger are durable state. Trust them over chat or memory.

## Documents and decisions

Each authoritative document owns one concern. Correct a stale or contradicted document in the same change that exposes the conflict.

Record decisions that constrain future work in an ADR or SEC entry. Agents may recommend a change but must not silently override one. Semantics that affect stored data or public contracts must be decided before implementation.

## Work-order design

Every numbered task should contain:

- context and dependencies;
- exact references;
- concrete deliverables;
- observable exit criteria;
- a binding out-of-scope section.

Keep tasks small enough for one executor. Tests ship with behavior, and named documentation updates in the same PR. Record unrelated discoveries as issues instead of expanding scope.

## Execution protocol

1. Read `PROJECT_INSTRUCTIONS.md`, the work order, and its references. Inspect current repository and PR state.
2. Claim work by pushing its branch. A ledger edit is not a claim.
3. Delegate implementation to an executor in an isolated worktree.
4. Run the work order's checks and the repository gates in `CONTRIBUTING.md`.
5. Open or update the PR. For numbered work, update the ledger only in the completing PR.
6. Delegate an independent review of the exact current head. The root conductor posts the report with `AGENT-REVIEW: APPROVE @<full-head-sha>` or `AGENT-REVIEW: CHANGES-REQUESTED @<full-head-sha>`.
7. A push invalidates the verdict. Resolve every current comment and repeat review when needed.
8. Merge only a current approved head with required CI green and every explicit human gate complete. Squash-merge through GitHub and serialize merges.

If work cannot finish, leave the branch green or commit `HANDOFF.md` with `HANDOFF: AWAITING-HUMAN`, `HANDOFF: BLOCKED`, or `HANDOFF: INTERRUPTED`, plus the next action and any failing checks. Never merge red or leave `main` broken.

## Verification principles

- Prefer observable exit criteria to estimates.
- Put business rules in pure, deterministic code where possible.
- Build permanent regression checks for contracts and invariants.
- Keep human gates explicit. Do not invent extra artifacts or simulate human approval.
- Treat current CI as necessary but still inspect the full diff and all PR comment surfaces.

## Audit checklist

- Authoritative documents agree and point to the current workflow.
- The read-first instructions are short and current.
- Every task has dependencies, deliverables, exit criteria, and out-of-scope boundaries.
- Claims, interruption recovery, and completion state are unambiguous.
- Tests and required docs ship with the change.
- Review is independent and bound to the exact PR head.
- Merge requires current approval, resolved comments, green gates, and completed explicit human actions.
- Concurrent executors have independent dependencies and file footprints; review and merge remain serialized.
