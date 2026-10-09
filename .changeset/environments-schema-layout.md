---
"@roonga/qcms-db": major
---

**Breaking: the published migration set is replaced, not extended. An existing database
must be deleted and recreated.**

Every QCMS object now lives in a schema QCMS named (ADR-40). The control plane - forms,
versions, questions, links, releases, the live environment set and admin identity - is in
`control`, one copy. The data plane - sessions, the append-only answer ledger,
submissions, tombstones, the outbox, webhooks and deliveries - is in `data_<env>`, **one
copy per environment**, with a `reporting_<env>` view set beside each. `public` is left
empty, off every search path, with `CREATE` on it granted to nobody.

**There is no upgrade path and none is written.** The whole migration chain is replaced by
one baseline that creates every schema in final shape, with no `DROP` and no `SET SCHEMA`
anywhere, because an appended migration cannot reach this layout: the chain has one
`answers` table and the design needs one per environment. Applying the new set to a
database created from an earlier release is not supported. Drop the database, create it,
run the role recipe in `docs/operations.md`, and migrate. `create-qcms-app` is the
supported path onto the new baseline. This is a one-time, Code Owner-approved exception to
the append-only migration rule (ADR-18), available exactly once, because QCMS is pre-1.0
and there is no installation to break.

**What changes for a consumer of the package:**

- `reporting.responses` and `reporting.answers_flat` become `reporting_<env>.responses`
  and `reporting_<env>.answers_flat`. A BI tool re-points at `reporting_prod` and its
  query is otherwise unchanged.
- A connection must set `search_path` to `data_<env>, control`. Every data-plane table is
  declared unqualified, so the search path is what chooses the environment; a connection
  that sets none resolves nothing.
- `createSession` and `insertSecureLink` take an `environment`, which is `NOT NULL` on
  both tables: a session's environment is pinned to its own schema by a `CHECK`, and the
  crossing foreign key into `control.secure_links` is composite on
  `(link_id, environment)`, so a link minted for one environment cannot start a session in
  another.
- `listResponses`, `getResponse` and `fetchResponsePage` take the environment, because
  `reporting_<env>` is on no search path and is the one schema these reads must name.
- One application role per environment plus a control role, replacing the single
  `qcms_app`. `docs/operations.md` carries the recipe; the grants themselves are in the
  baseline, guarded on each role existing.
- `qcms-db-environment create|drop` creates and removes an environment under the migration
  credential. A newly created environment needs an API restart.

The organisation plugin's tables (`organization`, `member`, `invitation`, `team`,
`teamMember`), the two session columns it adds, and QCMS's own declared additional fields
are in the mirror and are created by the baseline, so the authorisation work lands as code
rather than as a migration against a live deployment.
