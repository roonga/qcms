---
"@roonga/qcms-db": minor
---

The `./testing` harness now brings Testcontainers' Ryuk reaper up as its own step,
before it asks for a Postgres container, and reports a failure there as a reaper
failure. Previously any registry failure during the boot was reported as
`Could not PULL the test Postgres image`, naming the configured image and
`QCMS_TEST_POSTGRES_IMAGE` - even when the pull that failed was the reaper's, from
Docker Hub, which no Postgres override redirects. Docker reports a registry timeout
with no image reference in it (`Get "https://registry-1.docker.io/v2/": context
deadline exceeded`), so only the phase the failure came from can say which image it
was; splitting the phases is what makes the attribution sound. The reaper message
names `TESTCONTAINERS_RYUK_DISABLED` and `RYUK_CONTAINER_IMAGE` instead of the
Postgres override, and states that the Postgres image is not implicated.

`startTestDb` accepts `{ bootInfrastructure }` as a test seam alongside
`{ image }`, so a consumer's own tests can exercise the reaper-failure path
deterministically (a real forced failure is not deterministic: Testcontainers
reuses any reaper already running on the machine). `testcontainers` is now a
declared devDependency of this package, at the version
`@testcontainers/postgresql` already resolves to.
