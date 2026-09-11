---
"@roonga/qcms-db": patch
---

Say what the host was doing when a container boot or a pooled connection fails (issue #812).

A boot that reaches the Testcontainers port-bind ceiling under load fails with `not bound after 210000ms`, naming the ephemeral port Docker had just mapped, and a pooled connection that dies mid-suite fails with `Connection terminated unexpectedly`, naming nothing. Neither says that other lanes had ten more Postgres boots queued on the same daemon, which is what those failures usually are.

`startTestDb` now appends one line to both: the one, five and fifteen minute load over the CPU count, the running container count, how many carry a Testcontainers session label and how many distinct sessions they span, and which QCMS Compose stacks were up. It costs one `docker ps` and one `/proc/loadavg` read, taken at most once every five seconds and only on a path that is already failing.

Diagnosis only. No retry, no raised timeout, no serialised boot, and the error object that reaches the runner is the one `pg` raised, with its `code` and its stack intact. A query the database refused - a constraint violation, a missing relation - gets no snapshot.
