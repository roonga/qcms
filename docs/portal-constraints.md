# What binds the portal

**Status:** authoritative. Check this document before citing a portal rule. The decisions it
cites live in `docs/adr/portal.md` and `docs/adr/core.md`.

**Audience:** respondents, on browsers nobody chose, often reached by a link they were sent.

---

## Operation without JavaScript

**The no-JS path is required.** Every respondent flow completes with scripting disabled,
including submission (task 044), **except a form carrying a singleChoice question with
more than seven options** (issue #988, below). `docs/COMPONENT_GUIDELINES.md` makes no-JS
coverage binding for any input control, and the claim above is pinned by named specs
rather than by the suite in general: `apps/portal/e2e/no-js-submit.pw.ts` (start to
receipt), `apps/portal/e2e/no-js-required.pw.ts` (a step holding a required date, and
what happens to a submission that skips the browser),
`apps/portal/e2e/no-js-multi-choice.pw.ts` (a required multiChoice group),
`apps/portal/e2e/no-js-number.pw.ts` (a number question),
`apps/portal/e2e/no-js-retraction.pw.ts` (clearing an answer) and
`apps/portal/e2e/no-js-appearance.pw.ts` (issue #195). Read those six as the definition
of the claim. Two of its three qualifiers are gone: a form with a required date completed
only from issue #920 onward, and one with a required multiChoice or a required number only
from issues #974 and #18. The third, #988, is open.

**The one question shape that still cannot be answered without scripting** (**issue
#988**, found while fixing #974 and #18 and filed rather than decided). A `singleChoice`
question compiles to a RadioGroup at seven options or fewer and to a `Select` above that
(`SINGLE_CHOICE_SELECT_THRESHOLD`, `packages/a2ui-compiler/src/mapping.ts`), so the
threshold is what decides whether a form is affected: **a form whose single-choice
questions all have seven or fewer options is unaffected**, and the six specs above cover
only such forms. The vendored `Select` does render a real `<select>` carrying the real
options, but inside a clipped, visually-hidden container that is `aria-hidden="true"`,
with `tabindex="-1"` on the select itself, behind a visible trigger that is a
JavaScript-driven `<button aria-haspopup="listbox">`. So a respondent with scripting off
can neither see nor operate it, and a required one makes the browser try to report
validity on an unfocusable control and abandon the whole step's submission - the same
`An invalid form control ... is not focusable` dead end issue #920 documented for the
DatePicker. No fixture form compiles a `Select`, which is why every gate is green over it.
It is the same decision class as the two rulings below and is recorded for the Code
Owner, not answered here.

**The principle the no-JS rules follow** (Code Owner ruling, 2026-09-19, issue #974).
**JavaScript is assumed, and the no-JS form is a fallback that must work FUNCTIONALLY,
without rapid feedback.** A respondent without scripting must be able to enter, submit
and complete every flow; they do not have to be told about a problem before they submit,
because the API is authoritative and the step reports the API's answer after the round
trip (issue #964). Every decision below follows from that: browser validation is kept
where HTML can carry the rule, because it costs the respondent nothing; it is dropped
where HTML cannot, because keeping it there stops the flow instead of guiding it.

**Two questions render a different control on this path, on purpose**, and for one
reason in two shapes: the vendored control keeps its form value somewhere a respondent
without scripting cannot reach. In both cases the scripted render is unchanged, no
vendored byte moved (ADR-22), and hydration is unaffected because the SSR and the first
client render both paint native mode before `ProgressiveStep` swaps the whole form
(issue #121).

- **A date** (issue #920). The vendored DatePicker is a row of JS-driven spinbutton
  segments nobody can type into without scripting, and its form value rode on an
  `<input type="text" hidden required>` - `hidden`, not `type="hidden"`, so the browser
  tried to report its validity, could not focus it, and abandoned the whole step's
  submission. Native-submit mode emits `@roonga/qcms-ui`'s `NativeDateField` instead: one
  real `<input type="date">`, posting the same ISO day under the same field name.
- **A number** (issue #18, Code Owner ruling 2026-09-19). The vendored NumberField's
  visible box is `<input type="text" inputmode="numeric">` with **no `name`**, and the
  form value rides a separate `<input type="hidden">` that only JavaScript writes - so
  typing `3` filled the visible box, left the named field `""`, satisfied the browser
  (the visible box carries `required` and was non-empty), and the step submitted with the
  answer discarded. Native-submit mode emits `NativeNumberField`: one real
  `<input type="number">` under the question's own name, with the compiled `minValue`,
  `maxValue` and `step` as `min`, `max` and `step`. A question that admits fractions
  renders `step="any"`, because HTML's default for an omitted `step` is `1` and would
  refuse them; an integer question renders `step="1"`, so the browser refuses a fraction
  and the kernel's `NOT_AN_INTEGER` refuses one that reaches it anyway.

**Browser validation is kept, and the API validates the same constraints** (Code Owner
ruling, 2026-09-13, issue #920). Two consequences follow, and the first reads as a
limitation only until the second is read with it:

- **A required question cannot be CLEARED without scripting, except a multiChoice
  group.** HTML `required` refuses the empty submit before the form leaves the page, so
  emptying a required text field, date or number is blocked by the browser and only an
  optional one is clearable on this path. That is the ruling's intended behaviour, not a
  residue of it - the alternative was dropping `required` from the no-JS form and leaving
  the respondent to discover the gap after a round trip. The group is the exception
  because it carries no browser constraint at all; see the next bullet.
- **A required multiChoice group is the one place browser validation is dropped**
  (**issue #974**, Code Owner ruling 2026-09-19). HTML has no "at least one of these"
  constraint. react-aria encodes the rule by putting native `required` on every checkbox
  in the group and taking it off the moment something is selected
  (`packages/ui/src/components/a2ui/checkbox/Checkbox.tsx`, and the comment there says
  so). Taking it off is a re-render, which is JavaScript, so the server-rendered HTML
  froze `required` on all of them - and native `required` on a checkbox means _that_ box
  must be checked. Observed on the kitchen sink's "Which optional cover do you want?":
  with one of three checked the browser refused the submit and no POST left the page;
  with all three checked it submitted. So the step was impassable, and every step behind
  it unreachable. In native-submit mode the group's boxes now carry react-aria's ARIA
  encoding of the rule (`aria-required`) rather than the native one, reached through the
  `validationBehavior` seam for that group's subtree alone, so the group still marks
  itself required in its label, in `data-required` and to assistive technology while
  nothing blocks the submit. A blank group is refused by the API and reported on the step
  through the missing-required path below. Every other control on the step keeps
  validating natively, which `packages/ui/src/native-multi-choice.test.tsx` asserts
  directly. **A required group is therefore also the one required question that can be
  CLEARED without scripting**, which the bullet above does not cover: unchecking every
  box submits, and the `__qa__` marker makes it an ADR-33 retraction the API accepts and
  then reports as missing (`no-js-multi-choice.pw.ts`).
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
so nothing is tombstoned for a question nobody answered.

**No control is exempt from that any more.** Two were, and for the same reason both now
render a native control on this path (see above). The DatePicker left the list with issue
#920 and the NumberField with issue #18, so an OPTIONAL date or number can be emptied and
cleared without scripting, and a required one is refused by the browser like every other
required question - except a multiChoice group, which carries no browser constraint at
all (issue #974) and can therefore be cleared while required. The number's clear is
asserted in a browser on `q_annual_km`, the fixture's optional number
(`apps/portal/e2e/no-js-number.pw.ts`); no fixture form carries an optional date, so that
one is pinned at the transport instead: `packages/ui/src/clear-paths.test.tsx` for the
bytes the emptied control posts, `apps/portal/lib/server/step-form.test.ts` for the
`null` they decode to.

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
