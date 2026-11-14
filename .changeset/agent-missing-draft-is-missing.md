---
"create-qcms-app": patch
---

The assistant's form comparison reports a missing side as missing.

- A form with no working draft, or a version that was never published, now comes back with
  `outcome: "unavailable"` and every comparison field null, instead of a diff that reads as a
  draft whose questions were all removed.
- The tool's own description says so, so a reply cannot warn about a blank form that does not
  exist.
