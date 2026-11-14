---
"create-qcms-app": minor
---

Task 094: a fixed `prod` floor under every release workflow.

- Where `prod` is served beside a non-prod environment, `prod` accepts only a version already published to a non-prod environment (or a rollback) and never a draft. It applies over the default and every stored revision; no workflow configuration lifts it.
- On a site whose only environment is `prod`, a draft publishes to `prod`. With second approval on that is refused for now.
- The workflow write judges its prerequisite graph with the floor in place, so a rule that makes a non-prod environment wait on `prod` is refused as a cycle.
- `TEST_RELEASE_REQUIRED` keeps its code and now carries `environment` and `requiresAnyOf` details.
