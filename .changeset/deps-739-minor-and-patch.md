---
"@roonga/qcms-ui": patch
---

Dependency maintenance (Dependabot grouped minor/patch, 8 updates). `@roonga/qcms-ui` is
the only publishable package the group touches, and all three of its moves are in
`devDependencies`: `@testing-library/react` to `^16.3.3`,
`@testing-library/user-event` to `^14.6.6`, and `@types/react-dom` to `^19.2.5`.
None of them reach a consumer. The package is named here because the changeset
gate asks for it, not because a published artifact changes; no source in
`packages/ui/src/` changes and the public API is identical.

The other five updates are tooling or app scope and are not published: `eslint`
`^10.9.1`, `turbo` `^2.10.12` and `typescript-eslint` `^8.68.0` at the workspace
root, `next` `^16.3.3` in `apps/portal` and `apps/admin`, and `hono` `^4.13.5` in
`apps/api`.
