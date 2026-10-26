---
"create-qcms-app": minor
---

Make form publishing follow the selected environment in test/prod deployments. Publish to test creates and releases a version atomically; production reviews and releases an existing version with prior test or production history. Require switching to prod before production release, preserve second-person approval and legacy rollback, and reject stale environment confirmations.
