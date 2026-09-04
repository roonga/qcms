# QCMS

QCMS is a TypeScript engine for questionnaires with conditional logic. Start every session by reading `PROJECT_INSTRUCTIONS.md`. It is authoritative when instructions conflict.

## Role

This is a single-seat repository. The root session is the conductor: it plans, selects work, delegates implementation and review, communicates with the Code Owner, and serializes merges.

- Use `task-executor` for numbered tasks and issue implementation.
- Use `dev-task` for ad-hoc development, diagnostics, and long-running checks.
- Use `task-reviewer` for an independent review of the exact PR head. A reviewer reports findings but never fixes them.
- Keep the conductor responsive. Delegate work that is broad or expected to run for several minutes.

The Code Owner decides ADR changes, scope changes, explicit human gates, destructive operations, and ambiguous security acceptance. Prepare a recommendation and evidence, then ask. Never simulate a human decision.

## Planning and state

- Trust `origin/main`, the ledger in `docs/features/README.md`, open issues, PRs, and `git log` over chat or snapshots.
- Read the work order and its referenced documents before changing code.
- Check plans involving external technology against current official documentation and record material sources in the artifact.
- Flag conflicts with ADR or SEC decisions. A substantive plan change updates the decision record and every affected task or document in the same PR.
- Keep work within the stated deliverables and exit criteria. Fix only same-area, small discoveries that need no new decision, dependency, or golden-corpus change. Report everything else.
- Human gates and review artifacts apply only when an authoritative task or decision explicitly names them. Do not invent additional process artifacts.

## Repository rules

- Use **QCMS** in prose, titles, and UI. Use lowercase `qcms` only for repository, directory, and package identifiers.
- Do not use Unicode em dashes. Use punctuation or a spaced hyphen.
- Refer to the human owner as **Code Owner** in committed content. Legal attribution in `LICENSE` and the README is exempt.
- Use repo-relative paths in committed content. Do not commit personal names, machine-specific paths, real secrets, or AI attribution trailers.
- **No AI attribution anywhere an agent writes**, and the rule above is only half of it. A commit takes no `Co-Authored-By` naming a model and no `Generated with` trailer; a pull request body, a PR comment, an issue and a review take none either. The tooling default is to add one, so this is a rule an agent has to apply rather than inherit (Code Owner, 2026-08-24).
- Use pnpm only. Use Vitest below the browser and Playwright for browser tests.
- Follow `docs/COMPONENT_GUIDELINES.md` when adding or changing an input control.
- Follow `CONTRIBUTING.md` for dependencies, commits, PRs, and gates.

## Verification

- Run `pnpm verify` before landing a change.
- Also run `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` when the change affects `apps/portal`, `apps/admin`, or `@roonga/qcms-ui`.
- Run `QCMS_PORT_SEAT=<0-9> pnpm up:e2e` for Docker, boot-environment, or cross-service changes. Do not run it concurrently with `verify:browser` on the same seat.
- Force Docker-backed tests with `pnpm exec turbo run test --force` and confirm they executed rather than using cached output.
- Use `pnpm exec turbo run typecheck --filter=<pkg>` for a package-scoped typecheck.
- Write gate logs under this lane's own directory, `node scripts/agent-scratch.mjs <name>`, never the shared scratchpad root, and never read a gate result back from a path you did not create in the same command that wrote it. The scratchpad is shared across sessions whatever the harness says (issues #396, #602).
- `pnpm agent-loop:status` says whether the loop supervisor is running and current; `pnpm worktrees:prune` reports orphan worktree directories and `--apply` removes them.

## Change flow

- Work on one branch per task or issue in an isolated worktree. Never share a worktree between sessions and never push directly to `main`.
- Numbered tasks use `feat/NNN-slug`; issues use `fix/NN-slug` and close through `Fixes #NN` in the PR.
- The pushed branch is the claim. Park incomplete work with a committed `HANDOFF.md` whose first line states `HANDOFF: AWAITING-HUMAN`, `HANDOFF: BLOCKED`, or `HANDOFF: INTERRUPTED`.
- Open the PR from a branch rebased onto current `origin/main` with the applicable gates green.
- Review the complete PR at its current head. Record `AGENT-REVIEW: APPROVE @<sha>` or `AGENT-REVIEW: CHANGES-REQUESTED @<sha>` in a PR comment. A verdict for an older SHA is stale.
- Before merging, address every review comment, confirm the approval matches the current head, confirm required CI is green, and confirm any explicit human gate is complete.
- Squash-merge through GitHub and serialize merges. Never force-push `main` or create a local squash on `main`.

The detailed orchestration lives in `.claude/skills/`; the operator guide is `docs/DEVELOPER_GUIDE.md`.
