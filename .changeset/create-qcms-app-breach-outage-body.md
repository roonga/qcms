---
"create-qcms-app": patch
---

Scaffolded API: keep the breach-check outage body free of environment variable names
(issue #910).

`instance.ts`'s `503 BREACH_CORPUS_UNREACHABLE` ended its message with "set
`QCMS_ADMIN_PASSWORD_BREACH_CHECK=false` for a deployment that has none", and the assist
stream's `STEP_LIMIT` event ended "raise `QCMS_AGENT_MAX_STEPS`". Both strings are
serialized into a response body, and ADR-24's "clients receive behavior, not flag values"
reaches any environment identifier in a response body since the Code Owner widened it on
2026-09-12. A scaffolded app inherited both.

The templates now state the behaviour in the body and move the operator's half where an
operator reads it: `createAdminAuth` takes an optional `warn` sink, the API's auth mount
passes `deps.logger.warn` and `qcms:create-admin` passes stderr, so the variable is named
on a log line at the moment the lookup fails. Nothing about the control changed - same
status, same code, same fail-closed refusal - and the code was always the contract, so the
admin's change-password classifier and the bootstrap CLI both decide exactly what they
decided before.
