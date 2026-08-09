---
"@roonga/qcms-a2ui-compiler": patch
"@roonga/qcms-core": patch
"@roonga/qcms-db": patch
"@roonga/qcms-ui": patch
---

Rename the published npm scope from `@qcms` to `@roonga` (1.0 blocker #360). The
`qcms` organisation is not available on npm; the `roonga` organisation is the
Code Owner's, and matches the GitHub organisation the repo already lives in
(`roonga/qcms`).

| Was | Now |
| --- | --- |
| `@qcms/core` | `@roonga/qcms-core` |
| `@qcms/db` | `@roonga/qcms-db` |
| `@qcms/ui` | `@roonga/qcms-ui` |
| `@qcms/a2ui-compiler` | `@roonga/qcms-a2ui-compiler` |

Package names keep the `qcms-` prefix on purpose: `@roonga/core` would tell a
reader nothing about what the package is, and it would claim the generic name in
the organisation for whatever gets published next.

Subpath imports keep their shape: `@roonga/qcms-db/testing`,
`@roonga/qcms-ui/kit`, `@roonga/qcms-ui/theme.css` and the rest are unchanged
apart from the leading identifier.

The scaffolding CLI stays unscoped as `create-qcms-app`, and the private apps
keep their `qcms-api` / `qcms-portal` / `qcms-admin` names.

The product is still **QCMS**. Only the registry identifier changed: prose,
titles, UI strings, the `QCMS_` environment prefix and the branded ID prefixes
are all untouched.

Each of the four manifests also gains `publishConfig.access: "public"` (issue
#430). A scoped package defaults to restricted access, so without it the first
publish either fails or silently ships a package no adopter can install.
