---
"@qcms/core": patch
"@qcms/a2ui-compiler": patch
"@qcms/db": patch
---

Published tarballs no longer include test files, snapshots, or test-support directories: the `files` arrays now carry the same negation entries `@qcms/ui` adopted in #66. `@qcms/db`'s `./testing` subpath (the Testcontainers harness) still ships in full, including its transitive `src/schema` imports.
