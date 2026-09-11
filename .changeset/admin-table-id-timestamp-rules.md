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

Timestamps needed no format change: issue #279 (PR #794) already landed the operator's own
zone through `components/operator-time.tsx`, and the shared formatter already renders date,
clock and zone with no seconds.

**Day-only columns did.** The Code Owner ruled on 2026-09-11 that one zone means every
table, so the forms list's Published, the question library's Created and the version
history's Published name the operator's own calendar day rather than the instant's UTC one.
A row whose form was published at 23:30 UTC used to read as the previous day for every
operator east of UTC; it reads as their own day now. `formatOperatorDay` is the new
formatter and `OperatorDay` the component that keeps the swap hydration-safe, which is the
same mechanism the timestamps use rather than a second one beside it. A day column still
carries no clock, no zone name and no seconds.
