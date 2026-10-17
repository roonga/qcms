---
"@roonga/qcms-db": minor
"@roonga/qcms-csv": minor
"@roonga/qcms-observability": minor
"create-qcms-app": minor
---

Per-environment delivery, retention, reporting and operations (task 067, ADR-40, ADR-41,
ADR-17's Note, ADR-24's amendment).

**Reporting is now per environment and per workspace** (Q26). Each `reporting_<env>` keeps
the unprefixed `responses` and `answers_flat` the application reads (Q52, task 064) and
gains **a view set per workspace** beside them: `reporting_prod.home_responses`,
`reporting_prod.home_answers_flat` and so on, each a filtered projection of the pair it
sits next to, so the erasure anti-join and the submitted-only predicate stay in exactly one
view body. Every set has **its own read-only role**, `qcms_reporting_<env>_<slug>`, granted
`USAGE` on that one schema and `SELECT` on exactly its own two views: not `ALL TABLES IN
SCHEMA`, which is the one form that would hand a workspace's analysts every other
workspace's views. This is the one place in the design where the authorisation model is
expressed in database grants rather than in an API check, because a reporting consumer
writes their own SQL.

`qcms-db-environment reporting` reconciles every (workspace, environment) pair, and the
environment-create command emits the same statements for the environment it builds, so an
environment created next year arrives with every workspace's views in it. It is an operator
command rather than part of creating a workspace because creating a view is DDL and no
application role holds any (SEC-10); `docs/reporting-view.md` carries the recipe.

**`qcms_reporting_` joins the Q42 prefix list**, so the derived environment-name limit
drops from 53 bytes to 48. The limit is still computed from the list rather than written as
a constant, which is why adding the prefix was the whole of the change.

**The two retention TTLs are per environment** (Q11): `control.environments` already
carried `delivery_snippet_ttl_ms` and `outbox_payload_ttl_ms`, and the retention sweep now
reads them, with `NULL` leaving the installation-wide typed value in force.
`listEnvironmentRetention` is the read. The session TTL, the rate limits and every other
typed setting stay installation-wide (finding 6).

**`findSubjectPresence`** answers whether one environment holds a (form, session) pair and
whether it has already been erased, which is the read behind Q7's cross-environment
erasure offer. It returns existence and never content.

**A response export's file name carries the environment** and no column does (Q8):
`responseExportFileName` in `@roonga/qcms-csv` builds `frm_x-prod-v3-responses.csv` for all
three shapes. The columns are byte-for-byte what they were, and the formula-injection guard
of issue #470 is unchanged.

**`environment` is an allowlisted OTLP log attribute** (SEC-13). The deliverer and the
retention sweep each start once and iterate the live set, so every count they log is a
count in one environment, and the line that says an outbox is not draining now says which
one.
