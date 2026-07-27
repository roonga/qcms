---
"@qcms/ui": patch
---

A control never changes between controlled and uncontrolled, and never serves a
second question (issue #144).

`@qcms/ui` (patch: bug fix, no API change). react-stately decides
controlled-vs-uncontrolled by `value !== undefined` alone, so the `undefined` the
RadioGroup and Select adapters passed for "nothing selected" was read as
UNCONTROLLED: the first selection flipped the mounted control to controlled, and a
projection that re-targeted it at an unanswered question flipped it back. While
uncontrolled, react-aria serves its own last internal value in place of the
parent's absence, which is issue #95's divergence class. Both adapters now pass
react-aria's own no-selection value, `null`, which is controlled and (unlike `""`)
keeps the roving tabindex on the first radio and is never looked up as an option
key.

The second cause was control identity. `A2Renderer` keys a node's children by
array INDEX, so a step swap or a branch prune reconciles the control at index i
onto whatever control was there before, and a mounted control starts serving a
different question. The parent-owned value follows the new question but the
vendored control's internal state does not: on the kitchen-sink fixture, Continue
from an answered boolean RadioGroup carried react-aria's `lastFocusedValue` into
the next step's singleChoice group, which left EVERY radio at `tabIndex=-1`, so a
required question was unreachable by keyboard or screen reader while a pointer user
saw nothing wrong. The DatePicker and Select carried a stale date and a stale
option the same way. Each adapter now keys its control by questionId, so a
re-target is a remount and no control's internal state outlives its question.

One transition remains, on the DatePicker, and it is benign: the vendored body is
`value ? parseDate(value) : undefined`, so an unanswered date is uncontrolled no
matter what the adapter passes, and the first complete value adopts exactly the
value react-aria just reported. Removing it needs a `value: string | null`
pass-through upstream and a re-vendor; the vendored components are untouched here
(ADR-22).
