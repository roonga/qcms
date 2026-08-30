---
"qcms-admin": minor
---

The form's settings autosave, so the builder's form screen has one save model instead of
two (Code Owner, 2026-08-29).

"Save settings" is gone, and so is "Settings saved." A change to the challenge switch or
the minimum-time override reaches the API on the builder's own 600ms debounce, the same
one the draft uses, and the screen's ambient strip is what reports it. That closes the
consequence `plan/admin-design-contracts.md` §6 accepted knowingly on 2026-08-21: pressing
the button used to render "Saved <time>" and "Settings saved." at once, two legitimate
sentences that together read as one screen contradicting itself. §6 is amended in the same
change, because the amendment being resolved was a recorded decision rather than a
preference.

**The settings moved up into `FormBuilder`, and that is the part that made autosave safe
rather than merely tidier.** The form screen is unmounted the moment the reader selects a
step in the rail. A debounce owned by the panel would be cancelled by that unmount, with
the edit still waiting on it and no unpressed button left to explain where it went. The
builder does not unmount, so the save lands whichever screen the reader has moved to. The
panel is presentational now: a value, a callback, and a sentence for a refusal.

**One timestamp, not two.** A settings save feeds the builder's existing `lastSavedAt`,
its in-flight state and its failed state, so the strip covers everything the screen
stores. §6's "exactly one save statement per screen" is kept by the strip telling the
whole truth rather than by it telling part of one beside a rival.

**A refused write is still stated**, in the panel's own live region beside the two
controls it is about, and it is the only thing left between an author and the belief that
a deployment switch took when it did not. It stayed there rather than joining the
builder's standing notices for a mechanical reason: `aria-live` announces a change inside
a region that was **already** in the tree, and the standing notices render nothing at all
when quiet, so a settings failure appearing there would usually announce nothing. The cost
is named in §6 rather than buried: that sentence is not visible from the step screen.

The number field commits on blur rather than per keystroke, which is what keeps a figure
in the middle of being typed from being saved on its way to being finished.

`lib/forms/settings.ts` holds the patch helper the loop is built on, out of the panel and
under its own test: an unchanged pair produces nothing to send, which is what stops a save
from arming the next one, and `null` stays a value rather than an omission.
