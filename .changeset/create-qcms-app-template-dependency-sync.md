---
"create-qcms-app": patch
---

Re-sync the scaffolding templates after the grouped Dependabot minor/patch bump.
`packages/create-qcms-app/templates/common/apps/*/package.json` are generated from
the canonical `apps/*` manifests by `pnpm qcms:sync-templates`, so a dependency
range that moves in `apps/admin`, `apps/api` or `apps/portal` is template drift
until the regeneration lands alongside it.

Only dependency ranges moved, and only the ones the group bumped: the
OpenTelemetry set (the experimental packages to `^0.222.0`, the stable
`@opentelemetry/sdk-trace` and `@opentelemetry/sdk-trace-base` to `^2.11.0`,
`@opentelemetry/instrumentation-pg` to `^0.74.0` and
`@opentelemetry/instrumentation-undici` to `^0.32.0`), `next` to `^16.3.4`, and
the two exact CodeMirror pins `@codemirror/state` `6.7.2` and `@codemirror/view`
`6.43.10`. No template source changed and the CLI's own behaviour is identical; a
newly scaffolded app installs the same versions this repository resolves.
