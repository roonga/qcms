---
name: qcms-conductor-traps
description: "RETIRED 2026-08-01 - PowerShell/Windows conductor traps; no supported path reaches them since ADR-29's 2026-07-25 amendment"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9e5da939-93c1-4e50-a639-645e68acd50d
---

> **RETIRED 2026-08-01. Do not act on this file.** ADR-29 (amended 2026-07-25) made the dev container the canonical and only environment, retired `scripts/agent-loop.ps1`, and dropped the `PowerShell(...)` permission families; a Windows contributor's supported path is the container via Docker Desktop or Codespaces. No supported seat runs PowerShell any more, so none of these traps is reachable. Kept as history only - safe to delete outright, which is the Code Owner's call. See [[qcms-project-state]] for the same caveat on its older updates.

Conducting qcms merges from PowerShell on Windows (historical):
- **Commit messages with path-like tokens** (e.g. `/admin`, `feat/...`) trip a false-positive Remove-Item safety guard when passed inline in a compound command. Use `git commit -F <msgfile>` (heredoc to a temp file) for such messages.
- **`$env:VAR="x"` inside a `&&` chain is a parse error.** Set env vars in a separate statement before the chain, or use the Bash tool instead.
- Prefer the Bash tool for git/gh work in these repos - POSIX heredocs avoid both traps.

Related: [[a2ra-repo-notes]], [[qcms-project-state]].
