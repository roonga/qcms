---
"@roonga/qcms-a2ui-compiler": patch
"@roonga/qcms-core": patch
"@roonga/qcms-csv": patch
"@roonga/qcms-db": patch
"@roonga/qcms-observability": patch
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Rename the published npm scope from `@qcms` to `@roonga` (1.0 blocker #360). The
`qcms` organisation is not available on npm; the `roonga` organisation is the
Code Owner's, and matches both the GitHub organisation the repo already lives in
(`roonga/qcms`) and the container namespace already publishing to
`ghcr.io/roonga/qcms-*`.

| Was                   | Now                          |
| --------------------- | ---------------------------- |
| `@qcms/core`          | `@roonga/qcms-core`          |
| `@qcms/db`            | `@roonga/qcms-db`            |
| `@qcms/ui`            | `@roonga/qcms-ui`            |
| `@qcms/a2ui-compiler` | `@roonga/qcms-a2ui-compiler` |
| `@qcms/csv`           | `@roonga/qcms-csv`           |
| `@qcms/observability` | `@roonga/qcms-observability` |

Package names keep the `qcms-` prefix on purpose: `@roonga/core` would tell a
reader nothing about what the package is, and it would claim the generic name in
the organisation for whatever gets published next.

Subpath imports keep their shape: `@roonga/qcms-db/testing`,
`@roonga/qcms-ui/kit`, `@roonga/qcms-ui/theme.css` and the rest are unchanged
apart from the leading identifier.

The scaffolding CLI stays unscoped as `create-qcms-app`. Its own name does not
change, but every dependency range it stamps into a scaffolded app does, and its
template tree moves with the rest. The private apps keep their `qcms-api` /
`qcms-portal` / `qcms-admin` names.

The product is still **QCMS**. Only the registry identifier changed: prose,
titles, UI strings, the `QCMS_` environment prefix and the branded ID prefixes
are all untouched, and the repository is still `qcms`.

Version numbers are deliberately untouched. The initial published version is a
Code Owner decision that belongs to #360, not to the rename.
