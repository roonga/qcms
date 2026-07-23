---
name: filesystem-scope-boundary
description: Hard rule — never read or edit local folders outside H:\source\agent3
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a6a65c56-74f7-496e-9916-f285da57cc8a
---

Never read or edit any local folder outside `H:\source\agent3` and its subfolders.

**Why:** The user set this as an explicit boundary to keep my file access scoped to this project tree.

**How to apply:** Treat `H:\source\agent3\` (recursive) as the only readable/editable local scope. Refuse or ask before touching anything outside it — including the additional working directory `h:\source\sig-pilot\apps\web\public` that the harness lists, which falls outside this boundary. Reading external resources over the web is unaffected; this is about the local filesystem.
