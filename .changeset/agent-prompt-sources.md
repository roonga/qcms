---
"create-qcms-app": patch
---

Scaffold the assistant's prompt text as Markdown.

The scaffolded API now carries `src/features/agent/prompts/`: one Markdown file per system
prompt section, per tool description and per action kind, plus the `prompts.generated.ts`
built from them. Byte-identical prompt output, so nothing about a scaffolded assistant
changes; editing the text in an adopter's tree means editing Markdown and regenerating with
the generator that repository documents (issue #1284).
