# What binds the portal

**Status:** authoritative. Check this document before citing a portal rule. The decisions it
cites live in `docs/adr/portal.md` and `docs/adr/core.md`.

**Audience:** respondents, on browsers nobody chose, often reached by a link they were sent.

---

## Operation without JavaScript

**The no-JS path is required.** Every respondent flow completes with scripting disabled,
including submission (task 044). `docs/COMPONENT_GUIDELINES.md` makes no-JS coverage
binding for any input control, and the claim above is pinned by named specs rather than
by the suite in general: `apps/portal/e2e/no-js-submit.pw.ts` (start to receipt),
`apps/portal/e2e/no-js-required.pw.ts` (a step holding a required date, and what happens
to a submission that skips the browser), `apps/portal/e2e/no-js-retraction.pw.ts`
(clearing an answer) and `apps/portal/e2e/no-js-appearance.pw.ts` (issue #195). Read
those four as the definition of the claim: it held for a form with a required date only
from issue #920 onward, and for a form with a required multiChoice it still holds only for a
respondent who checks every box (issue #974, and the checkbox note under the ruling below).

**A date question renders differently on this path, on purpose** (issue #920). The
vendored DatePicker is a row of JS-driven spinbutton segments nobody can type into
without scripting, and its form value rode on an `<input type="text" hidden required>` -
`hidden`, not `type="hidden"`, so the browser tried to report its validity, could not
focus it, and abandoned the whole step's submission. In native-submit mode the renderer
emits `@roonga/qcms-ui`'s `NativeDateField` instead: one real `<input type="date">`,
posting the same ISO day under the same field name. The scripted render is unchanged, no
vendored byte moved (ADR-22), and hydration is unaffected because the SSR and the first
client render both paint native mode before `ProgressiveStep` swaps the whole form
(issue #121).

**Browser validation is kept, and the API validates the same constraints** (Code Owner
ruling, 2026-09-13, issue #920). Two consequences follow, and the first reads as a
limitation only until the second is read with it:

- **A required question cannot be CLEARED without scripting.** HTML `required` refuses
  the empty submit before the form leaves the page: emptying a required text field, or
  unchecking the last box of a required group, is blocked by the browser, so only an
  optional question is clearable on this path. That is the ruling's intended behaviour,
  not a residue of it - the alternative was dropping `required` from the no-JS form and
  leaving the respondent to discover the gap after a round trip.
- **A required multiChoice group asks for EVERY box without scripting, not one**
  (**issue #974**). Found while observing the numeric branch for #920 and not fixed by it,
  because it is the same decision class the ruling above settled for dates and needs its
  own. react-aria encodes "at least one" by putting native `required` on every checkbox in
  the group and taking it off the moment something is selected
  (`packages/ui/src/components/a2ui/checkbox/Checkbox.tsx`, and the comment there says so).
  Taking it off is a re-render, which is JavaScript, so the server-rendered HTML freezes
  `required` on all of them - and native `required` on a checkbox means _that_ box must be
  checked. Observed on the kitchen sink's "Which optional cover do you want?": with one of
  three checked the browser refuses the submit and no POST leaves the page; with all three
  checked it submits. A respondent who wants one optional cover cannot get past that step,
  and the step behind it is where the numeric branch lives. It does not affect a group that
  already holds an answer, because that render emits no `required` at all, which is why
  `no-js-retraction.pw.ts` (whose group is seeded) has never seen it.
- **A submission that gets past the browser is still refused, and now says so.** The API
  is authoritative either way: its answer endpoint refuses `""` and `[]` outright
  (`EMPTY_ANSWER_NOT_ALLOWED`) and its submission sweep refuses a session with a visible
  required gap (`MISSING_REQUIRED`, invariant I9). What #920 added is the report: the
  whole-step route carries the API's own `flowState.missingRequired` into the re-render,
  narrowed to the questions the posted form asked, and the step comes back with the same
  summary the hydrated flow draws plus a message in each field's own slot, with every
  answer the API accepted still in place. Before that, a crafted post and an honest blank
  field produced the same silent reload.

**The two paths report a gap differently, and only one of them marks the field.** Without
scripting the respondent gets the summary AND a message in the field's own slot, because
they get one render per POST and nothing re-validates under them as they type. The hydrated
flow draws the summary alone. That asymmetry is deliberate on this side and open on the
other: **issue #967** asks whether the hydrated path should mark the field too.

**Clearing an answer works without scripting too** (issue #127). A native form cannot say
"I emptied this": it posts an emptied text box exactly as it posts a never-touched one,
and posts an all-unchecked checkbox group as nothing at all, so the BFF - which holds no
answer state and may not ask for any (R2) - used to read both as "never answered" and
leave the stale answer standing, while the scripted path had retracted it since issue
#98. The renderer now emits a hidden `__qa__<questionId>` companion for each question
that currently holds an answer, and the whole-step route reads a marked field arriving
empty as an ADR-33 retraction, posted to the same answer endpoint with the same `null`
body the scripted path posts for the same gesture. An unmarked empty field stays silence,
so nothing is tombstoned for a question nobody answered. One control is exempt by
construction and not by choice: a NumberField carries its form value in a hidden input
that JavaScript syncs, so with scripting off the seeded answer is what serializes and it
cannot be emptied at all - that is issue #18, phase 4.

**What a no-JS respondent now sees on a number question, observed rather than reasoned**
(issue #18, and the reason it is worth writing down here). On the kitchen sink's numeric
branch the visible control is `<input type="text" required inputmode="numeric">` carrying
no `name`, and the form value rides a separate `<input type="hidden" name="q_accident_count">`
that only JavaScript writes. So typing `3` fills the visible box, leaves the named field at
`""`, and satisfies the browser - the visible box is non-empty, so the submission goes. The
field posts blank, the API reports the question missing, and since issue #920 the step comes
back saying so: "How many? needs an answer." in the summary and "This question needs an
answer." beside the field. **That message is true of the page it is drawn on**: the field
re-renders blank, because the API holds nothing for it, so the respondent is being told
something correct about what is on screen. What is silently lost is the `3` they typed, and
that loss is #18 rather than #920 - before #920 the same round trip produced the same blank
field with no message at all, so the report is strictly more information and not a new
defect. The report is deliberately NOT suppressed for number questions: doing so would hide
a genuinely blank required number, which is the common case, and would not give the typed
value back.

The DatePicker was the second such
control until issue #920 replaced it on this path with a native day input, which a
respondent can empty; an OPTIONAL date is therefore clearable without scripting now, and
a required one is refused by the browser like every other required question (see the
ruling above). No fixture form carries an optional date, so that path is pinned at the
transport rather than in a browser: `packages/ui/src/clear-paths.test.tsx` for the bytes
the emptied control posts, `apps/portal/lib/server/step-form.test.ts` for the `null` they
decode to.

## Rule evaluation

**R2.** The browser never talks to the API directly, and the portal never evaluates rules. It
renders projections the API computed. This is a correctness boundary.

## Navigation and answers

**ADR-28.** Explicit Continue, Back and Submit. No collapse-on-answer and no derived cursor.

**ADR-31.** Answer commitment semantics: each control commits at its decided moment, and an
emptied control reports **absence** rather than an empty string or an empty array.

## Appearance

**ADR-30.** Managed themes. Appearance is operator-configurable, and the portal's tokens live
in `packages/ui/src/theme.css`.

## Accessibility

**WCAG 2.2 AA is a floor.** Task **030**'s manual screen-reader pass is a Code Owner human
gate on this app.

## Internationalization

**ADR-27.** No hardcoded user-facing strings. Copy lives in the message catalogue and
formatting is locale-aware.

## Security

**SEC-1 to SEC-13**, verified as a system by task 040, whose sign-off is a launch gate. Two
that shape portal work directly:

- **The origin belt** refuses cross-origin state-changing requests, and every refusal writes
  one structured log line so a locked-out respondent is countable.
- **SEC-13** is a strict allowlist on anything logged or exported: no answers, no PII, no
  secrets.

## Input controls

**`docs/COMPONENT_GUIDELINES.md` is binding** for adding or changing any input control:
vendoring fidelity, the registry and adapter contract, the ADR-31 commit moment, and
conformance, keyboard, no-JS and focus coverage.
