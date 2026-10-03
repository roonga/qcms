---
"@roonga/qcms-observability": patch
---

Two environment lines join the OTLP log allowlist by name (ADR-40).

`outbox delivery pass failed` and `the environment set and the configuration disagree` are
the lines that say **which** environment is not moving and **why** an environment is being
served from nowhere, and an allowlist that collapsed them to `application.event` would
hide exactly that. Both bodies carry environment names and an error string only: never a
connection string and never a credential (SEC-8).
