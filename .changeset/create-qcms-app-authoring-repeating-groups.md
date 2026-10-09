---
"create-qcms-app": patch
---

The scaffolded admin and API can author a repeating group (task 074, ADR-42).

Templates are generated from `apps/`, so this is the same edit the repository's own admin and
API carry, regenerated with `pnpm qcms:sync-templates`. What an adopter gets is the authoring
half of the one repeating-group primitive the kernel gained in 071:

- the builder's draft holds a group - `DraftStep.items` is a tagless union mirroring the
  kernel's, with pure mutations for every group edit, and the BFF's draft reader carries a
  group back from the API rather than dropping it;
- a group panel reached from the step editor's boundary row or from the group's row in the
  rail, carrying the name and id, the member list in the step editor's own ownership grid, the
  count source, the bounds with `max` marked required on both bounded sources, the instance
  heading with a live preview, and the presentation;
- the rules editor's three whole-group operators as structured editors, the per-instance scope
  chip, and the sentences that state `everyInstance`'s empty-group reading and its negation's;
- a test bench with an instance dimension, evaluable at zero instances;
- and a draft preview that expands a group through the same renderer the portal uses, from a
  roster it mints itself, because a preview has no session to take one from.

The draft assistant's system prompt documents the three operators, the group's shape and the
refusals a proposal can walk into, and `SYSTEM_PROMPT_VERSION` moves to 2 with the text.
