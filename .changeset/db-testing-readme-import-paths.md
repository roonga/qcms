---
"@roonga/qcms-db": patch
---

Correct the test-harness section of the package README, which described the
import style in a way that contradicted the example printed directly beneath it.
The prose said this package's own tests reach the harness by relative import and
"everyone else by the subpath", then showed a `@roonga/qcms-db/testing` example without
saying which of the two it was illustrating. It now states plainly that the
example is the adopter path, that the package's own tests use the relative path
(`../testing/harness.js`) and therefore never exercise the subpath, and that this
is why the subpath carries tests of its own.

Documentation only: no runtime, type or API change. It ships because the README
is published with the package.
