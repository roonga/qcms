---
"create-qcms-app": minor
---

Scaffold the agent-assisted form building slice (task 041, ADR-25). The
templates are a mirror of the canonical `apps/api` and `apps/admin`, so this is
the regeneration `pnpm qcms:sync-templates` produces rather than a separate
authoring pass: the API's assist slice, the admin panel and its BFF route, and
the diff and stream helpers.

A scaffolded app is unaffected by default. `QCMS_FLAG_AGENT_AUTHORING` defaults
to `none`, the flag gates the route _mount_ rather than a handler branch, and
the four provider packages are dynamically imported on first use, so a default
deployment registers no assist path and loads none of them.

The scaffolded API manifest does gain the five AI SDK runtime dependencies,
because the template mirrors the canonical app exactly. They are installed
whether or not an operator ever names a provider.
