---
"@qcms/a2ui-compiler": patch
"@qcms/core": patch
"@qcms/csv": patch
"@qcms/db": patch
"@qcms/observability": patch
"@qcms/ui": patch
---

Every emitting package now clears `dist` before `tsc` runs (`scripts/clean-dist.mjs`, issue #494). `tsc` overwrites what it emits and deletes nothing, so a file left by an older configuration (a renamed source file, a widened `exclude`, a withdrawn subpath export) survived every rebuild and kept resolving. A forced rebuild did not help either: turbo tars whatever matches `dist/**` when the task ends, so the stale artifact was re-cached and restored elsewhere. No published output changes.
