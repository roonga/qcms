---
"@roonga/qcms-db": minor
"create-qcms-app": patch
"@roonga/qcms-observability": patch
---

Add `getDraftForUpdate`, `agentStepRecorded` and `listFormAgentActions`, which the builder's card-less edit route kind and the publish wizard's agent-change read use (task 111).

The scaffolded API template mirrors the edit route kind, its Undo and the agent-change read. The OTLP log allowlist exports the new `agent edit refused` event.
