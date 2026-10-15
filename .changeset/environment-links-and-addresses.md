---
"create-qcms-app": minor
---

Scaffold the `/<env>/` respondent addresses, the mount split and the per-environment
closed state (task 066, ADR-40, SEC-14).

The scaffolded API mounts one respondent group per environment - `prod`'s at its
unprefixed addresses and every non-prod environment's at `/<env>` - with anonymous entry
as a group of its own that only `prod` mounts. `QCMS_MOUNT` takes an environment's name
as a surface, so an adopter restricts a test environment by leaving it out: every one of
its addresses is then a `404` rather than a refusal.

The scaffolded portal resolves and strips the prefix in `proxy.ts`, serves no `/f/{slug}`
under a prefix or on a host named in `QCMS_PORTAL_ENVIRONMENT_HOSTS`, and emits prefixed
addresses from every redirect, form action and browser-side `fetch`.
`QCMS_PORTAL_ENVIRONMENTS` is the non-prod set and is empty by default, which serves
`prod` only.

The mint takes a required `environment`, with no default, and returns a URL carrying the
prefix; close and reopen act on one environment's intake. A scaffolded `.env` carries both
new portal variables, commented, with the ingress recipe they pair with.
