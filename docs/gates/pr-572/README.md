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
| `loadPinnableQuestions` | `FormBuilder` subtree | per-pin "Version not found" tag, the picker's "no version matches this search" panel, the move menu's "No other published version" | the entire builder, every draft edit, **Add question** |

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

## The files

- `red-first.txt` - the 16 new tests run against the **unfixed** tree (`git checkout` of
  the pre-change files, test file unchanged). **6 fail, 10 pass.** The four
  "makes no claim" tests fail with the defect verbatim in their `Received` line:
  `ops.webhooks.empty` and `ops.deliveries.emptyTitle` inside
  `<div class="qcms-empty">` beneath `data-testid="qcms-alert"`, `forms.links.empty` in
  the same shape, and `data-pin-state="missing"` carrying `forms.step.pinMissing` on the
  form's only pin. The two move-pin tests fail with `TypeError: library.find is not a
  function`, which is the pre-change signature refusing the `ReadState` the fixed one
  takes. The 10 that pass are the controls: the error alert must still render, a genuinely
  empty read must still get §3's panel, a read with rows must still get the §2 table, and
  the builder must still be usable.
- `green-after.txt` - the same file after the fix, verbose, 16 passed.

Runner output in both is filtered to repo-root-relative paths.

## What this evidence does not cover

Two of the corrected claims live behind a control an operator has to press, and a static
render of the page opens neither: the library picker's failure copy is inside a dialog, and
the move-pin menu's is inside a popover. The menu is covered by rendering `StepEditor`
directly with a popover stand-in that renders its children. **The library picker's failure
copy is asserted nowhere**, at any layer, and that is stated here rather than left to be
discovered.
