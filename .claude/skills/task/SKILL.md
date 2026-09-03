---
name: task
description: Execute one numbered QCMS task end to end. The conductor claims and coordinates; an executor implements; an independent reviewer verifies the exact PR head; the conductor merges only a current approved head.
---

Orchestrate one numbered task from `docs/features/NNN-*.md`. The conductor coordinates and merges; subagents implement and review.

1. **Pre-flight.** Read `PROJECT_INSTRUCTIONS.md`, the task file, the ledger, its ordering exceptions, `origin/main`, remote `feat/*` claims, and any open PR for the task. Refuse a completed task or an unmet dependency. If an authoritative human gate prevents autonomous progress, report it rather than simulating it. Every lane in this flow, the conductor included, writes logs and scratch files under its own directory from `node scripts/agent-scratch.mjs` and never the shared scratchpad root, and never reads a gate result back from a path it did not create in the same command that wrote it (issues #396, #602).
2. **Claim or recover.** A new task is claimed by pushing `feat/NNN-slug` from current `origin/main`. Re-list remote claims to catch a race. For an existing claim, inspect its commits, `HANDOFF.md`, worktree registration, PR, comments, and latest `AGENT-REVIEW` verdict before acting. Never discard executor commits with `git reset --hard`.
3. **Execute.** Spawn `task-executor` in an isolated worktree. Before assembling the brief, look for an open PR amending a contract the task cites: a ruling can be correct, agreed, and invisible at `main` while its amendment sits unmerged, so brief the pending version explicitly rather than letting the lane implement the superseded one. Record any ruling made during the lane as a comment on the task's issue or PR as well as in the amendment that makes it normative (issue #631, `CONTRIBUTING.md` "Ground rules"). On interruption or a decision, commit and push `HANDOFF.md`, remove the worktree, and report. Prepare only the human-review material explicitly required by the task.
4. **Prepare the PR.** When implementation is done, rebase onto current `origin/main`, run the applicable gates on that rebased tree, and push. **A push is evidence only when the remote ref actually moved**, at every push in this flow: `git symbolic-ref -q HEAD` before it, and `git ls-remote origin <branch>` against `git rev-parse HEAD` after it, because a commit made on a detached HEAD leaves the branch ref behind while `git push` answers `Everything up-to-date` (issue #567). Open a PR with a Conventional Commit title, checked exit criteria, any `Fixes #NN` line, the executor report, and a `## Retro` section. Add the PR number to the ledger row and append non-empty friction to `docs/RETRO.md` on the same branch, then push and wait for required CI.
5. **Review the current head.** Spawn `task-reviewer` with the PR number, task file, and current `headRefOid`. Post its complete report as a PR comment. The final line must be `AGENT-REVIEW: APPROVE @<sha>` or `AGENT-REVIEW: CHANGES-REQUESTED @<sha>`.
6. **Fix findings.** On changes requested, send every finding and unresolved review comment to the executor. Rebase if needed, rerun applicable gates, push, wait for CI, and invoke a fresh reviewer for the new head. After two unsuccessful fix cycles, park with `HANDOFF.md` and ask the Code Owner.
7. **Land.** Immediately before merging, confirm:
   - the latest approval matches the current head;
   - all issue comments, line comments, and review bodies are resolved;
   - required CI is green;
   - the branch is current with `origin/main`;
   - every explicit human gate is complete;
   - no open PR uses this branch as its base, or each child has been safely retargeted and rebased.

   Any push or rebase makes the approval stale and requires a fresh review. Squash-merge through GitHub, preserving `Fixes #NN`, and delete the branch. Confirm the merge commit is green before landing more work.

8. **Clean up.** Remove only this task's registered worktree, then run `node scripts/prune-worktrees.mjs` and read its report. It is the proof the rule above asks for: `git worktree list` is the registry, and the sweep removes only unregistered directories, keeping anything registered, anything without a `.git` file, anything with uncommitted work, and anything touched in the last day. Apply it with `--apply` when the report is what you expect. A parked branch remains the durable claim; a truly abandoned branch is deleted so the claim releases.

Never merge red, skip the independent reviewer, widen scope, push `main`, or perform a human sign-off.
