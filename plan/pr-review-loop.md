# PO PR-review loop

The PO seat runs this as a recurring loop (`/loop` in `qcms/plan/`): watch for open PRs on `roonga/qcms`, review each one as a stranger would, and squash-merge the clean ones. It is the merger half of the `/next-issue` PR-per-issue flow (skill step 7 opens the PR; this loop lands it). Adopted 2026-07-25 on the Code Owner's direction.

## Each iteration

1. **List.** `gh pr list -R roonga/qcms --state open --json number,title,headRefName,isDraft,url,statusCheckRollup,author`. Skip drafts. Skip PRs already reviewed at their current head SHA (a prior approval or changes-requested review on the same head means wait, do not re-review).
2. **Review the diff as a stranger.** `gh pr diff <NN>`. Checks, against the written rules (CI gates are a subset - `plan/**` is excluded from several):
   - **Scope:** the diff does what the linked issue/task names and nothing more; discoveries belong in new issues.
   - **Tests:** present at the layer ADR-23 assigns (Vitest below the browser, Playwright e2e); no new test frameworks.
   - **Added-lines grep:** em dash (U+2014), the Code Owner's personal name, machine-specific paths (`/home/<user>`, drive letters, assumed parent folders), AI attribution (`Co-Authored-By: Claude`, `Claude-Session:`, "Generated with Claude"), real secret values.
   - **Conventions:** `Fixes #NN` present in a `fix/` PR body; conventional-commit title; docs named in acceptance criteria updated in the same diff (staleness rule).
   - **CI:** `statusCheckRollup` fully green. Local gate and CI are not supersets of each other (issue #19) - when a diff touches gate-adjacent files, run the root gate in a temp worktree before merging.
3. **Verdict.**
   - **Findings:** `gh pr review <NN> --request-changes` listing each finding concretely (file, line, rule). Dev-loop PRs have no live author; flag the PR to the Code Owner in the loop report - a future `/next-issue` stale-claim pass or the Code Owner picks it up.
   - **Clean:** approve. Then merge only if all of the following hold; otherwise approve-and-escalate:
     - Not human-gate territory: no visible portal/admin UI change lacking the Code Owner's screenshot sign-off, no ambiguous SEC-* acceptance, no `.archive`/destructive change.
     - Not a PO-authored PR without the Code Owner's explicit OK (any channel counts, but it must exist - never rubber-stamp your own work).
4. **Merge (strictly serialized - one at a time, ever).**
   - Branch must be current with `main`. If behind: rebase in a temp worktree, re-run `pnpm build && pnpm typecheck && pnpm test && pnpm lint` at root, push, wait for CI.
   - `gh pr merge <NN> --squash --delete-branch`, keeping `Fixes #NN` in the squash body so the issue auto-closes.
   - Post-merge: append the PR's `## Retro` lines (skip `none`) to `docs/RETRO.md` under `## issue #NN - <title>` with the merge date; commit to `main` (plain push, never force). This replaces the pre-PR flow's "in the landing commit" retro append.
5. **Report.** One line per PR handled (reviewed / merged / changes-requested / escalated) in the loop summary. If nothing is open, say so and sleep - never idle-poll faster than the loop cadence.

## Never

Merge red, merge across a human gate, merge unserialized, force-push, self-approve PO-authored work without the Code Owner's OK, or leave a changes-requested PR unmentioned in the report.
