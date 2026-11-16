---
"create-qcms-app": patch
---

Scaffold the assistant's prompt text as Markdown.

The scaffolded API now carries `src/features/agent/prompts/`: one Markdown file per system
prompt section, per tool description and per action kind, plus the `prompts.generated.ts`
built from them. Editing that text in an adopter's tree means editing Markdown and
regenerating, `prompts/rendered/` is the as-sent view a change is reviewed against, and
`SYSTEM_PROMPT_VERSION` is held to the sources by a recorded hash (issue #1284).
