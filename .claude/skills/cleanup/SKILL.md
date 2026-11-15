---
name: cleanup
description: Clean up what finished sub-tasks and background agents left behind - worktrees, branches, dev stacks, containers, scratch files. Use when the Code Owner says "/cleanup", "clean up the completed" or "clear finished agents".
---

Remove the leftovers of finished sub-tasks. Only what this session's agents created, only when it is finished and nothing is lost. Never delete first and ask later.

1. Find the finished work:
   - `ListAgents` for sub-agents whose state is completed, failed or killed. Skip any still running and anything they are using.
   - For each, read its report or its output for what it created: worktree, local branch, Compose project and seat, containers, scratch directory, background processes. Do not guess names from patterns, and do not touch anything the session did not start.
2. Check each item is safe to remove, from the repository and Docker, not from memory:
   - Worktree: clean `git status`, and every commit is on the pushed branch or in `origin/main`. A rebased history fails `merge-base --is-ancestor`, so also compare content with `git cherry origin/<branch> HEAD`; a `+` line needs a look before removal.
   - Branch: pushed, and its work present on the remote or merged. Use `git branch -d`; stop and ask before any `-D`.
   - Stack or container: not used by a running agent or process, and belonging to a seat or project this session started. Never stop a seat the Code Owner runs for themselves.
   - Scratch directory: no running process has it open, and nothing in it is the only copy of a result, a transcript or a credential still needed. A secrets file is deleted only after its owner stage is done.
3. List what you would remove, grouped, one line each with the reason it is safe, and what you are keeping and why. Ask once with `AskUserQuestion` (remove all / remove only some / cancel). A request to clean up the completed is that confirmation when the list is only finished agents' own leftovers; anything beyond that gets the question.
4. Remove, in this order, and stop at the first surprise:
   - stacks: `QCMS_PORT_SEAT=<n> pnpm dev:down` from a worktree of the repo, before that worktree goes;
   - containers and background processes the agent started;
   - worktrees: `git worktree remove <path>` with no `--force`, then `git worktree prune`;
   - local branches that are merged or on the remote;
   - scratch directories.
5. Report in two short lists: **Removed** and **Kept** (with why). Say plainly that finished entries in the agent list cannot be dismissed with a tool, and that anything in the Code Owner's own setup was left alone.

Never: force-remove a worktree, delete unpushed work, push, stop another seat's stack, read or print a secret, or remove a path under a repository the session does not own.
