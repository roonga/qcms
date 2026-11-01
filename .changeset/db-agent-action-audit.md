---
"@roonga/qcms-db": minor
---

Add the append-only `control.agent_actions` table SEC-17 records every confirmed agent step
in, in SEC-15's precedent shape.

Migration 0007 creates it with `(proposal_id, step_index)` unique, which is the per-step
single-use property a replayed step fails on, and no foreign key, so a row cannot cascade
away with what it describes. Its grant set is `control.access_audit`'s, emitted by the same
function rather than written out again: `qcms_app_control` holds `SELECT` and `INSERT`,
every `qcms_app_<env>` holds `INSERT` alone, and `UPDATE` and `DELETE` are revoked from
every `qcms_app%` role by prefix. The baseline's per-environment pass gains the same
guarded `INSERT`, so an environment created later arrives with it.

`writeAgentActionRow` carries no `RETURNING`, because an environment role holds no `SELECT`
here; `listProposalSteps` is the in-order read the provenance check uses, and
`listAgentActions` is the workspace read, scoped exactly as the access audit's is.
