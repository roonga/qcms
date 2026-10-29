---
"create-qcms-app": patch
---

The scaffolded assistant panel is visibly alive from a turn's first second (tasks 080, 081).

Templates are generated from `apps/`, so this is the same edit the repository's own admin and
API carry, regenerated with `pnpm qcms:sync-templates`. For an adopter it changes what a turn
looks like while it runs, and adds one operator setting:

- **a timeline row the moment a tool call starts streaming**, not when the SDK has finished
  parsing it. A `propose_draft` call carries a whole form definition, so that gap was the
  longest silent stretch of a turn;
- **prose kept in the segments the provider sent**, so a sentence before a tool call and the
  explanation after it are two bubbles with the step row between them, and the proposal card
  quotes only the last;
- **a keep-alive comment through a silent stretch**, so an ingress idle timeout does not cut a
  long turn;
- **a multi-line composer with Stop**: Enter sends, Shift and Enter start a line, and Stop ends
  the turn and the upstream call;
- **the assistant's own mark** in the panel header and beside each assistant turn, as inline
  SVG on the theme tokens, in place of the word "Assistant"; its visor glows while a turn runs,
  driven by the same state the panel announces in words;
- **links in assistant prose only to an admin page route**, on a closed list, with no query
  string and no fragment. A route handler is never a link target, so prose cannot start the
  response export download;
- **focus that stays where the author put it**: a proposal moves focus to its heading only when
  focus was already inside the panel, and Accept or Discard moves it to the outcome line that
  stays in the conversation as a record;
- **`QCMS_AGENT_THINKING`**, `off` or `summary`, default `off`. Under `summary` the provider's
  reasoning summary is forwarded to the panel as a collapsed Thinking disclosure in plain text.
  It is never logged, stored or replayed, and the scaffolded admin never learns the setting's
  value: the disclosure renders because the events arrived.
