# Issues 572 and 544: evidence

One directory for two issue records, because they are one defect. Issue 544 filed the
pattern (`ok ? data : []` collapsing three read states into two); issue 572 holds the
concrete site list and says so itself. The convention 544 asks for - "one answer for all
of them, so the next component does not invent a third" - can only be settled once, so
both are fixed on one branch and this is the evidence for both.

## What to approve

Contract §3, "error states are not empty states", applied at the four sites that were
still collapsing on `main`:

| Read | Component | Suppressed on a failure | Kept on a failure |
|---|---|---|---|
| `listWebhooks` | `WebhookConfig` | empty panel, table | heading, intro, live regions, **Add endpoint** |
| `listDeliveries` | `DeliveryDashboard` | empty panel, table | heading, intro |
| `listLinks` | `SecureLinks` | empty panel, table | heading, intro, **Mint links**, mint result panel |
| `loadPinnableQuestions` | `FormBuilder` subtree | per-pin "Version not found" tag, per-pin "No label in the library", the picker's "no version matches this search" panel, the move menu's "No other published version" | the entire builder, every draft edit, the row grip menu, **Add question** |

The line being applied at each site is the one issue 521 derived at the response browser:
"and nothing else" means nothing that CLAIMS anything about the failed read. Chrome that
stays true is fine, including a creating action that still works. Issue 521's first attempt
suppressed the whole component and reverted that before landing, because suppressing
everything removes a working capability; none of the four sites here does that.

## Why there are no screenshots

The only renders this change alters are the four **failed-read** states, and the capture
harness cannot reach any of them. `listWebhooks`, `listDeliveries`, `listLinks` and
`loadPinnableQuestions` all run in the Next **server** process against a live API, so
`page.route()` never sees the request and no browser gesture can make one fail;
`playwright.config.ts` records the underlying constraint (a `webServer` cannot be booted
twice with two environments). Issue 543 hit exactly this wall on the same class of change
and `docs/gates/pr-543/` is the same shape as this directory; issue 544 filed the
constraint itself.

Two things were checked rather than assumed before settling for this:

- **The reachable states are byte-identical before and after.** Every branch that a
  browser can arrive at - an empty read and a read with rows, on all four screens - emits
  the same markup as it did on `main`, so a capture would only reproduce frames already
  committed under `docs/gates/pr-514/`.
- **No fault-injection path exists.** The four reads take no parameter that makes them
  fail, and `loadPinnableQuestions` returns a failure only when its LIST read fails (a
  per-question detail failure is skipped, not propagated). Making one of them fail on
  demand would need a new facility in front of the API, which is a harness capability and
  a decision this change is not entitled to make. It is reported as a follow-up rather
  than built here.

The static-markup layer stands in for the frames, which is the layer issue 544 named and
issues 513, 514, 543 and 521 established.

## Rebased onto issue 517's ownership grid

This branch was written against `f9174c6` and rebased onto `c9a5219`, which landed issue
517's rewrite of the pin list as a mixed-ownership grid. That rewrite moved every
library-owned cell of the grid out of the component and into the pure view model
`lib/forms/pin-grid.ts`, which turned out to be a better seam for this fix than the one it
replaced: all four of the builder's false claims are now decided in one function, are
asserted directly in `lib/forms/pin-grid.test.ts`, and no component decides any of them.
The conflict was resolved by taking 517's file whole and re-applying the fix to the new
shape, not by reverting any of it.

## The files

- `red-first.txt` - the new and amended tests run against the **unfixed** tree
  (`git checkout c9a5219 --` of every source file, test files kept). Three test files,
  **7 failed, 9 passed, 9 skipped**, and the failures fall into three kinds that are
  worth telling apart rather than counting together:

  **Four are the defect verbatim**, in their own `Received` lines:
  `ops.webhooks.empty` and `ops.deliveries.emptyTitle` inside `<div class="qcms-empty">`
  beneath `data-testid="qcms-alert"`; `forms.links.empty` in the same shape; and
  `data-pin-state="missing"` carrying `Version not found` on the form's only pin, beneath
  the page's own `forms.error.libraryFailed` alert.

  **Two are the pre-change signature refusing the distinction**: the move-pin cases die
  with `TypeError: library.find is not a function`, as do `pin-grid.test.ts` and
  `pin-grid-ownership.test.tsx` at import (the 9 skipped are that file's remaining cases,
  which never ran). That error IS the finding: on the unfixed tree there is no way to hand
  the grid "the library was not read", because the parameter is an array.

  **One is neither, and is called out so it is not mistaken for defect evidence.** The
  success-branch control ("still tags a pin the library really has lost") fails on the old
  tree for a test-vocabulary reason: the string it asserts moved from a component, which
  resolves copy through this file's mocked catalog and therefore emits a KEY, into
  `lib/forms/pin-grid.ts`, which is redirected to the real module and therefore emits
  English. The old tree had the behaviour; it spelled it differently.

  The 9 that pass are the controls that matter: the error alerts must still render, a
  genuinely empty read must still get §3's panel, a read with rows must still get the §2
  table, and the builder must still be usable.
- `green-after.txt` - the same three files after the fix, verbose, 38 passed.

Runner output in both is filtered to repo-root-relative paths.

## What this evidence does not cover

Two of the corrected claims live behind a control an operator has to press, and a static
render of the page opens neither: the library picker's failure copy is inside a dialog, and
the move-pin menu's is inside a popover. The menu is covered by rendering `StepEditor`
directly with a popover stand-in that renders its children. **The library picker's failure
copy is asserted nowhere**, at any layer, and that is stated here rather than left to be
discovered.
