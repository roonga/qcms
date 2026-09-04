---
"@roonga/qcms-core": patch
"@roonga/qcms-a2ui-compiler": patch
"@roonga/qcms-db": patch
---

Published tarballs no longer include test files, snapshots, or test-support directories: the `files` arrays now carry the same negation entries `@roonga/qcms-ui` adopted in #66. `@roonga/qcms-db`'s `./testing` subpath (the Testcontainers harness) still ships in full, including its transitive `src/schema` imports.
