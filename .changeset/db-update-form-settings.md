---
"@qcms/db": minor
---

Add `updateFormSettings(exec, formId, { challengeRequired?, minSubmitMs? })`, a
partial update of the per-form abuse-control settings on the `forms` identity row
(task 026's domain config, ADR-24 tier 2). An absent key leaves its column alone
and `minSubmitMs: null` restores the deployment default, so the form builder's
settings panel (task 033) can save one field without echoing the other back. The
helper reaches only those two columns: `slug`, `defaultLocale` and `status` stay
with their own doors (`createForm`, `closeForm`/`reopenForm`).

No schema change: the columns have existed since migration `0008`.
