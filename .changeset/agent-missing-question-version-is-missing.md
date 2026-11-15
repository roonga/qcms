---
"create-qcms-app": patch
---

The assistant's question comparison reports a missing version as missing.

- A version that does not exist on either side now comes back with `outcome: "unavailable"` and
  `identical` and `changedFields` null, instead of an empty field list that reads as two versions
  with nothing between them.
- The tool's own description says so, so an empty `changedFields` can only mean a comparison that
  really found no difference.
