---
"@roonga/qcms-a2ui-compiler": patch
"@roonga/qcms-core": patch
"@roonga/qcms-ui": patch
"@roonga/qcms-db": minor
---

Publishable manifests declare `publishConfig.access: public`, so a first scoped publish cannot fail as private or, worse, succeed as private (issue #430).

`@roonga/qcms-db/testing` also gains two changes. A failure to reach the Docker daemon is now reported as daemon connectivity instead of an image pull, so a dead socket no longer sends the reader to check a registry mirror that is working (issue #171). And the container-boot budget is exported as `CONTAINER_BOOT_TIMEOUT_MS`, one place instead of a copy in every integration file, raised to 240s because a boot that takes longer than two minutes is a boot under contention rather than a broken one (issue #746). A consumer's own hooks can take that constant as their budget; the harness applies it to Testcontainers' startup wait itself, less a margin, so a boot that will not finish fails with the message that names the image and the cause rather than with the runner's bare hook timeout.
