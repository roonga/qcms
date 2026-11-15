---
"@roonga/qcms-core": patch
"@roonga/qcms-db": minor
"create-qcms-app": patch
---

Appearance schema and the workspace themes table: a nullable `appearance` jsonb on `control.form_drafts` and `control.form_versions`, immutable content-addressed logo storage whose key is pinned to the SHA-256 of its bytes, `control.workspace_themes` with its page tint, the workspace appearance lock column, and the `derive` access-audit kind. Publishing copies the draft's appearance into the frozen version.

Environment roles read the logo store through a column grant on `key`, `content_type` and `bytes` alone, exported as `CONTROL_READ_COLUMNS`. `insertFormVersion` now takes `appearance` as a required parameter.

`AppearanceCorners` is exported from `@roonga/qcms-core` so the themes table can type its column from the shared module.
