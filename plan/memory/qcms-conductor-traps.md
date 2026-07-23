---
name: qcms-conductor-traps
description: PowerShell/Windows traps when landing qcms tasks as conductor
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9e5da939-93c1-4e50-a639-645e68acd50d
---

Conducting qcms merges from PowerShell on Windows:
- **Commit messages with path-like tokens** (e.g. `/admin`, `feat/...`) trip a false-positive Remove-Item safety guard when passed inline in a compound command. Use `git commit -F <msgfile>` (heredoc to a temp file) for such messages.
- **`$env:VAR="x"` inside a `&&` chain is a parse error.** Set env vars in a separate statement before the chain, or use the Bash tool instead.
- Prefer the Bash tool for git/gh work in these repos — POSIX heredocs avoid both traps.

Related: [[a2ra-repo-notes]], [[qcms-project-state]].
