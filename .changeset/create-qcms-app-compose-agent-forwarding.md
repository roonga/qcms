---
"create-qcms-app": patch
---

Make agent-assisted authoring reachable on a scaffolded project's Compose stack (issue #1063).

The scaffolded `docker-compose.yml` named none of the agent-authoring variables, so setting
`QCMS_FLAG_AGENT_AUTHORING`, `QCMS_AGENT_MODEL` and `QCMS_AGENT_API_KEY` in `.env` reached
nothing and the builder's assist panel could not be turned on. The `api` service now forwards
the flag, the model id, the provider key, the endpoint override, the step ceiling and the
assist rate limit; the `admin` service forwards the flag alone, so the key never enters the
admin container; the one-shot migration gets none of them. Every one defaults to empty, so
a project that sets nothing keeps the feature off exactly as before. `.env.example` carries
a commented block to copy.
