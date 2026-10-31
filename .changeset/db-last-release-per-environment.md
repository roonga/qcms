---
"@roonga/qcms-db": minor
---

`lastReleaseAtByForm` answers one environment rather than all of them, and takes it as its
second argument (issue #1191).

The Operations forms table shows a Last release column beside a header chip naming one
environment, and the query behind it reported the newest release anywhere, so a form last
released to `test` dated its `prod` row. Both the column and the `released` sort read the
environment the chip shows, which is the one the route already receives.

Callers pass the environment they are reporting on. A form that never reached it is absent
from the map rather than falling back to another environment's instant.
