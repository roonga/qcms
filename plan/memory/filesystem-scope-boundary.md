---
name: filesystem-scope-boundary
description: Hard rule - never read or edit local folders outside the agent3 tree (H:\source\agent3 on Windows, ~/src/agent3 on WSL2)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a6a65c56-74f7-496e-9916-f285da57cc8a
---

Never read or edit any local folder outside the agent3 tree: `H:\source\agent3` on the Windows host, `~/src/agent3` (`/home/ravi/src/agent3`) on WSL2, `/workspaces` inside the devcontainer.

**Why:** The user set this as an explicit boundary to keep my file access scoped to this project tree.

**How to apply:** Treat the agent3 tree (recursive, whichever mount the session runs from) as the only readable/editable local scope, plus the session scratchpad under `/tmp`. Refuse or ask before touching anything outside it - e.g. `sig-pilot` paths fall outside this boundary. Reading external resources over the web is unaffected; this is about the local filesystem.
