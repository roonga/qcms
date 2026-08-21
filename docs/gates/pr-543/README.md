# Issue 543: evidence

## Why there are no screenshots here

The only render this change alters is the **failed dead-letter read**, and the capture
harness cannot reach it: `listDeadLetters` runs in the Next server process against a live
API, so no browser gesture and no `page.route()` can make it fail (issue 544 records the
same constraint). The two states the harness *can* photograph, an empty queue and a queue
with rows, emit byte-identical markup before and after, so a capture would only reproduce
`docs/gates/pr-514/webhooks-empty-light-*.png` and `dead-letters-table-light-*.png`.

The static-markup layer stands in for the frames, which is the layer issue 544 named and
the one `empty-and-table-states.test.tsx` established.

## The files

- `red-first.txt` - the four new tests run against the **unfixed** component. One fails,
  and its "Received" line is the defect verbatim: `<div class="qcms-empty" ...>` carrying
  `ops.deadLetters.emptyTitle` and `ops.deadLetters.empty`, rendered directly after
  `data-testid="qcms-alert" data-variant="error"`. The other three pass before the fix and
  are the controls: the error alert must still render, a genuinely empty read must still
  get contract §3's panel, and a queue with rows must still get the §2 table.
- `green-after.txt` - the same two files after the fix, verbose, 18 passed.

Runner output in both is filtered to repo-root-relative paths.

## What to approve

Contract §3, "error states are not empty states", applied to the dead-letter queue: on a
failed read the queue now renders its heading and intro and nothing else, and the empty
panel appears only for a read that succeeded with no rows.
