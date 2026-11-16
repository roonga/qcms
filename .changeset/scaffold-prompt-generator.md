---
"create-qcms-app": patch
---

Scaffold the assistant's prompt generator, not only its Markdown (issue #1307).

- The scaffolded project receives `scripts/generate-prompts.mjs` and the constants it
  imports, wired as `pnpm prompts:generate` and `pnpm check:prompts`.
- A new `pnpm verify` runs the check before building and typechecking, so a generated
  module left stale fails rather than shipping.
- Prettier arrives as the root dev dependency the generator formats with, with the
  repository's settings and the prompt Markdown held outside it.
