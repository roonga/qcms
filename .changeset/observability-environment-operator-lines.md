---
"@roonga/qcms-observability": patch
---

Three environment lines join the OTLP log allowlist by name (ADR-40).

`outbox delivery pass failed` says **which** environment's queue is not draining, and the
deliverer steps over one environment's blip rather than ending the sweep, so without the
line a stalled queue is invisible. `the environment set and the configuration disagree` is
the last record a process writes before refusing the boot, and `could not check the
environment set against control.environments` is the other outcome of the same check, which
warns and binds; they are separate names because an operator has to tell "the sets
disagree" from "the sets were never compared". Every body carries environment names and an
error string only: never a connection string and never a credential (SEC-8).
