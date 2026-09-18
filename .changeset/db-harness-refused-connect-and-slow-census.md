---
"@roonga/qcms-db": minor
---

Give a refused connect the host snapshot, and report a census the daemon was too busy to answer as a reading rather than as a silence (issues #939 and #942).

Two halves of the same diagnostic going quiet under load.

A connect that Postgres refused arrived bare. `pg` raises it as `connect ECONNREFUSED 127.0.0.1:<port>` with an `ECONNREFUSED` code and nothing about Docker, and the marker set that decides which failures get a host snapshot matched `ECONNRESET`, `EPIPE` and `socket hang up` but not a refusal - so the one shape that says "the container reported ready and had nothing listening on the mapped port" was the one shape that reached a reader with no load line beside it, indistinguishable from a defect until the file was re-run alone. `ECONNREFUSED` is now a marker, with the same contract as the rest: annotate, never retry, never swallow. A refusal happens below the protocol, before any statement is sent, so no database that answered and said no can produce it.

The census that builds that snapshot asks the same Docker daemon every lane is queuing containers on, and it slows down with the machine: `docker ps` measured at 2.56 to 5.82 seconds on a host at load 100 carrying 54 Testcontainers Postgres, against a 3 second ceiling. It rendered as `docker unknown (the daemon could not be asked)`, which is also what a machine with no Docker installed says, so the line written to tell a busy host from a broken one said nothing at the moment it mattered. The ceiling is unchanged - this only ever runs where something has already failed, and waiting longer makes a red run's report slower - and the overrun is now reported as what it is: `docker unknown (the daemon did not answer the census within 3005ms)`, beside a load line that is still there. A census that did answer now carries its own cost (`docker 7 running, 4 Testcontainers across 3 sessions in 212ms`), because a daemon that took 2.9 seconds is a loaded daemon one tick before it is an unanswered one. A timed-out reading is reused for 30 seconds rather than 5, so a cascade of failures cannot re-pay the ceiling over and over on the host least able to afford it.

For anyone who built a `HostProbes` by hand: `dockerPs` now returns a `DaemonCensusReading` (`{ stdout, elapsedMs, timedOut }`) instead of `string | undefined`, `HostSnapshot` carries that reading as `census`, and `runDockerCensus` and `DOCKER_CENSUS_TIMEOUT_MS` are exported. `TestDb`, `startTestDb`, `withTestDb` and everything else reachable from `@roonga/qcms-db/testing` are unchanged.
