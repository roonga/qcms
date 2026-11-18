---
"create-qcms-app": patch
"@roonga/qcms-observability": patch
---

Scaffold mirror of the agent builder's write path.

- The New form builder creates the form on one Confirm card naming the workspace and the slug.
- Draft edits apply with no card, each with its own Undo, latest first.
- The publish wizard shows every change since the last publish, with the assistant's steps marked.
- The docked assistant's accept requires the single-use accept token its proposal minted and writes an audit row from it; the draft save no longer takes an `agentAssisted` mark.
- A refused accept pauses autosave and asks whether to undo the assistant's change or keep it as an own edit; a keep is a plain save under the refused token, recorded as an adopted proposal.
- The OTLP log allowlist exports the accept's and the adopt's refusal lines.
