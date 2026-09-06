---
"qcms-admin": minor
---

Give rule editing a route of its own, `/forms/{formId}/rules`, and leave the builder a
compact read-only rules lens (issue #669).

`plan/admin-shell-poc/admin-shell-poc.html` has always drawn the builder's Rules card as a
short read-only list, with a dedicated screen (`rules-screen-poc.html`) carrying the
editing. The app shipped the other arrangement: an editor on the builder. That was a POC
speaking rather than a POC failing to speak - a card's contents are exactly what a static
drawing expresses - and under POC-wins the Code Owner ruled on 2026-09-05 that it is built
as drawn.

**The interesting half is what the ruling made a condition of building it.**
`plan/admin-ux-audit.md` §5.5 had refused a rules route, and for a reason that had nothing
to do with taste: the builder's rule-scoped issue entries are links that MOVE FOCUS to the
offending rule, which is why the API's issues carry a structured domain path rather than a
positional index. Move the rules to a route and every one of those anchors resolves to an
element that is no longer on the page - a link that renders, announces as a link, takes
focus, and does nothing. Nothing about that failure looks wrong on screen, which is why the
audit's objection was worth taking seriously rather than overruling.

So the anchors were rebuilt rather than abandoned. Every rule address is now the route plus
the fragment (`/forms/{formId}/rules#rule-{ruleId}`), minted in one place so it cannot come
back a caller at a time, and the destination focuses the row on arrival - the half a
fragment cannot do for itself across a navigation. The two pre-split addresses
(`/forms/{formId}#rules` and `#rule-…`) are forwarded rather than dropped, because a
bookmark can still carry one. The two-hop path §5.5 priced is what an author gets, and it
is accepted knowingly, which was that paragraph's actual request.

The sibling half of the same drawing went the other way and stays that way: Validation is
still a selection on the builder (issues #659, #719), because its entries point at controls
the builder itself renders and the refused-publish list reuses them verbatim. That path was
re-checked and is untouched. Two halves of one POC screen using two mechanisms is
deliberate, and `plan/admin-design-contracts.md` §7 writes the pair up as one decision so
nobody later reads it as a contradiction.

Two smaller things fell out of the move. The rail's Rules row stops being a row the builder
drew for itself - a button here, an anchor there, two shapes to keep the same height - and
becomes an ordinary sibling route rendered by one component on all nine form screens, which
retires the defect class `apps/admin/e2e/rail-screens.pw.ts` exists for. And the draft's
save loop moved into `lib/forms/autosave.ts`: two screens now hold a working draft, and two
copies of a debounce would be two save models with one name, which is the thing
`plan/admin-design-contracts.md` §6 spent two amendments closing.
