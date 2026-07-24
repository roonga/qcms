---
name: filesystem-scope-boundary
description: Hard rule - never read or edit local folders outside the parent folder holding the project checkouts
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a6a65c56-74f7-496e-9916-f285da57cc8a
---

Never read or edit any local folder outside the parent folder that holds the project checkouts (the qcms repo and its sibling repos such as `a2-react-aria`), whichever machine or mount the session runs from (Windows host, WSL2, or devcontainer `/workspaces`).

**Why:** The Code Owner set this as an explicit boundary to keep my file access scoped to the project tree. The rule is about the tree's *contents*, not any particular clone location - anyone can clone into any parent folder.

**How to apply:** Treat the checkout's parent folder (recursive) as the only readable/editable local scope, plus the session scratchpad under `/tmp`. Refuse or ask before touching anything outside it - unrelated projects on the same machine fall outside this boundary. Reading external resources over the web is unaffected; this is about the local filesystem.
