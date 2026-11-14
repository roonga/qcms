---
"@roonga/qcms-db": minor
"create-qcms-app": patch
---

Appearance schema and the workspace themes table: a nullable `appearance` jsonb on `control.form_drafts` and `control.form_versions`, immutable content-addressed logo storage, `control.workspace_themes`, the workspace appearance lock column, and the `derive` access-audit kind. Publishing copies the draft's appearance into the frozen version.
