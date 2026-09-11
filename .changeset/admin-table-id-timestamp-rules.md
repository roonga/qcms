---
"qcms-admin": minor
---

Render an identifying id one way, and a timestamp one way, in every admin table (issue
#582).

`plan/admin-design-contracts.md` §2 governs both, and both had been applied table by table
rather than once: nine tables each wrote their own `<code className="qcms-link-id">` around
a whole id, so a session id filled a column an operator reads a row by.

`components/entity-id.tsx` is the identifying cell now, and `lib/entity-id.ts` carries the
rule that decides how it renders. §2 is two rulings, and the property that chooses between
them is minting convention rather than type: an **opaque** id (`ses_`, `lnk_`, `whk_`,
minted as random bytes and uniformly long) renders its type prefix plus eight characters
with a copy control, and a **derived** id (`q_`, `opt_`, `frm_`, minted from author-written
text) renders whole, because a prefix of one is itself a valid id of the same kind and
nothing on screen distinguishes it from data.

**Where the rest of an abbreviated id goes is the part worth knowing.** It stays in the
cell, inside `.qcms-visually-hidden`: it costs no width, a screen reader announces the row
by its whole id rather than by a prefix that identifies nothing, and a selection copies the
value rather than the abbreviation. That is what answers §2's "the full id goes somewhere
reachable without JavaScript" for secure links and webhooks, which have no detail route to
carry it. No ellipsis anywhere, which is the clause §2 states outright.

Timestamps needed no format change: issue #279 landed the operator's own zone and the
shared formatter already renders date, clock and zone with no seconds. What is new is that
the rule is now checked rather than remembered. `app/(shell)/table-cell-rules.test.ts`
enumerates every file in the app that renders a table cell and requires that no cell render
an id-shaped or instant-shaped value as text, so a tenth table is covered the day it is
written rather than the day someone remembers to add it to a list.
