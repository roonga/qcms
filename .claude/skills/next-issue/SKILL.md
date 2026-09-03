---
name: next-issue
description: Select one actionable QCMS GitHub issue and carry it through executor implementation, exact-head independent review, and serialized squash merge.
---

Select and land one GitHub issue. The issue body is the work order; the conductor coordinates and merges.

1. Stop if the shared checkout is dirty. Every lane here, the conductor included, writes logs and scratch files under its own directory from `node scripts/agent-scratch.mjs` and never the shared scratchpad root, and never reads a gate result back from a path it did not create in the same command that wrote it (issues #396, #602). Inspect open `fix/*` PRs and claims before selecting fresh work. A current-head `AGENT-REVIEW: CHANGES-REQUESTED` cycle outranks new work; a stale verdict needs fresh review; a current approval proceeds to final merge checks.
2. List open issues. Exclude closed-routing labels, decision-blocked work, issues folded into unfinished numbered tasks, and live claims. Prefer `security`, then `bug`, unlabeled, and `enhancement`; within a tier prefer the smallest well-specified issue.
3. Claim with a `fix/NN-slug` branch from current `origin/main` and a concise issue comment. Re-check remote claims before continuing.
4. Spawn `task-executor` in an isolated worktree with the issue body and relevant authoritative references. Before assembling the brief, look for an open PR amending a contract the issue cites: a ruling can be correct, agreed, and invisible at `main` while its amendment sits unmerged, so brief the pending version explicitly rather than letting the lane implement the superseded one. Record any ruling made during the lane as a comment on the issue as well as in the amendment that makes it normative (issue #631, `CONTRIBUTING.md` "Ground rules"). Prepare only the human-review material explicitly required by the issue.
5. Rebase completed work onto current `origin/main`, run applicable gates, push, and open one PR for the issue. **A push is evidence only when the remote ref actually moved**, at every push in this flow including the claim: `git symbolic-ref -q HEAD` before it, and `git ls-remote origin <branch>` against `git rev-parse HEAD` after it, because a commit made on a detached HEAD leaves the branch ref behind while `git push` answers `Everything up-to-date` (issue #567). Use a Conventional Commit title, checked acceptance criteria, `Fixes #NN`, the executor report, and `## Retro`. Append non-empty friction to `docs/RETRO.md` on the branch before final review.
6. Spawn `task-reviewer` with the PR number, issue body, and current head SHA. Post the report as a PR comment. On changes requested, return every finding to the executor, push fixes, rerun gates and CI, and review the new head again.
7. Merge only when the latest `AGENT-REVIEW: APPROVE` matches the current head, all comment surfaces are resolved, required CI is green, the branch is current, and explicit human gates are complete. Any push invalidates approval. Check for child PRs before deleting the branch. Squash-merge through GitHub with `Fixes #NN`, then confirm the merge commit is green.
8. Clean up the worktree and claim. Park unfinished work with `HANDOFF.md` and an honest issue comment.
9. End with one line: `NEXT-ISSUE: LANDED #NN`, `NEXT-ISSUE: RESUMED #NN`, `NEXT-ISSUE: AWAITING-HUMAN <reason>`, `NEXT-ISSUE: BLOCKED <reason>`, or `NEXT-ISSUE: NOTHING`.

With a count argument, only independent executors may run concurrently. Reviews and merges are always serialized. Never batch issues into one branch, merge red, skip review, or expand scope.
