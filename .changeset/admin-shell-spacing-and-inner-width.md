---
"qcms-admin": patch
---

Give the admin shell the section-padding token its POCs draw, and the inner width layer they
specify (issues #675 and #668).

Both were raised by the #648 / #657 lane against its own work rather than found afterwards,
and both are reconciliations with the drawings rather than new design.

**One padding value, two call sites (#675).** Every POC that draws the shell declares
`--admin-section-pad: 1.25rem` and then spends it on `.topbar__inner` and on `.main` alike.
That single value is _how_ the drawings get the shared left edge #648 asks for: the bar's
first item and the column's content both start 20px from the page edge. #648 landed the
shared edge at `px-6` on both instead, matching this app's own `p-6` column rather than the
drawing, and recorded the 4px as a deviation instead of burying it. The token is now spent in
both places, so the edge is still one edge and it is the drawn one. The property #648 is
about is unchanged; only the value moved. There is no third call site to keep in step: the
footer that carried one went on 2026-08-23.

**Width has two layers, and the app now has both (#668).** A POC caps an outer `.main` and
then, on some screens, caps the content inside it again - a 720px `.editor-column` inside a
1600px `.main`, a 640px `.respondent-frame` inside another. #657 collapsed the two into the
route table by giving each screen the number a reader actually sees, which is the inner one
wherever there is one. That reads correctly and renders wrong by two paddings, because a cap
on `<main>` sits outside a padding the drawn element sits inside. All three took one cap,
so all three rendered one column: 672px, which is 32px over the drawn 640 frame and 48px
under the drawn 720 editor column. So `/questions/{id}`, `/forms/{id}/preview` and
`/forms/{id}/versions/{n}` take their POC's outer 1600 in `apps/admin/lib/measure.ts`, and
the inner number is carried by the element itself. Each drawn number now renders at the size
it is drawn.

**The respondent frame is a drawn element, not a width**, which is #668's first complaint and
the part a cap could never deliver. `preview-versions-poc.html` renders the preview and the
stored version inside a bordered, rounded, shadowed inset with a bar above it reading
"Respondent view", and its comment says the 640 is chosen so the boundary reads "as a
device-like inset rather than as 'the page just got narrower here'". After #657 the page just
got narrower there. The frame wraps the theme island's carrier rather than replacing it, so
its bar sits outside `data-qcms-theme-scope` and is painted in this app's own tokens: the
admin labels the inset, and a respondent is never shown that label. It is opt-in because the
third preview surface, the question editor's, is drawn as an ordinary card with no frame at
all.

Two consequences worth stating. The `narrow` (45rem) route cap is gone: it existed as the
one-layer compromise for exactly those three screens, at neither drawn number, and no route
can take it now. The token survives in `app/globals.css` because `components/save-model.tsx`
still caps its tooltip with it. And where a POC's outer layer is `none` - the deployment-ops
file caps `.main` at nothing - there is no outer number to take, so `/responses` and
`/responses/erasures` keep the per-screen cap #657 gave them, which is why #668's own closing
list names three screens rather than six.

`apps/admin/e2e/measure.pw.ts` gains the two measurements the existing sweep could not make:
it measures `<main>`, so it was blind both to a second cap inside `<main>` and to the padding
between the two.
