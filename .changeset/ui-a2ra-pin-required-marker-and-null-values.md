---
"@roonga/qcms-ui": minor
---

Move the a2ra vendoring pin to the upstream commit carrying four fixes, and retire the
adapter workarounds three of them existed to remove (issues #99, #549, #148, #151).

**Minor rather than patch** because the vendored surface `@roonga/qcms-ui` re-exports changes in
a way a consumer can observe and depend on: `RadioGroup`, `Select` and `DatePicker` now
accept `value: string | null`, which is a widened public type, and a required date
question renders a marker it did not render before. Nothing is removed and no call site
has to change, so it is not a major.

**#99, the required marker.** A required `DatePicker` rendered no required marker while
the six other required controls did, so the required state was not perceivable until the
error fired. The marker lives inside each vendored control's own `<Label>`, and the
DatePicker simply omitted it, so there was no adapter seam to fix it at without diverging
from upstream (ADR-22). It is fixed upstream and re-vendored: `date-picker.styles.ts`
gains the `requiredIndicator` token and both pickers render the marker `aria-hidden`, so
the computed accessible name is unchanged. `required-marker.test.tsx` derives the set of
required controls from the golden corpus and asserts the marker for each.

**#549, the unparseable value.** The vendored `DatePicker` bound
`value ? parseDate(value) : undefined`, and `parseDate` THROWS on anything that is not a
valid ISO day, so a value a caller had not already validated was a render-time exception
rather than an empty control (a whole-screen 500, as issue #521 found). Upstream now
guards every parse in both pickers, and `date-unparseable.test.tsx` feeds a range of
unparseable stored answers through the adapter.

**#148, the `null as unknown as string` cast.** The vendored prop types narrowed `value`
to `string` while passing it straight to react-aria-components, whose own contract is
`string | null`, so the adapter's no-selection value travelled through a documented
double cast. Upstream accepts `string | null` and the cast is gone. The DatePicker also
stops collapsing every empty spelling to `undefined` internally, so it is now genuinely
controlled: the last uncontrolled-to-controlled flip at this seam is gone,
`controlled-flip.test.tsx` asserts zero warnings where it used to assert one, and the
`WARN: A component changed from uncontrolled to controlled.` entry in the portal's
forwarded-warning gate is deleted on its own stated removal condition.

**The admin's date bounds.** `constraints-editor.tsx` omitted its `value` prop entirely
for "no bound set", because an omitted prop was the closest thing to "controlled with no
value" that a `value: string` signature allowed. It now passes `null`, so the control is
controlled from first render and the first date an author picks no longer flips it.

**#151, the duplicate react-aria-components: deduplicated, and NOT the fix.** The
portal's closure held two copies (1.19.0 transitively through `@a2ra/core`, 1.20.0
direct), which is two SSR id and context providers and was #151's leading explanation for
the NumberField hydration attribute mismatch on reload. `@a2ra/core` raises its floor to
`react-aria-components@^1.20.0` and `@internationalized/date@^3.12.3` upstream, and the
lockfile here converges on one copy of each. `resume.pw.ts` gains the reload of a
NumberField step that no spec had ever performed, and running it settled the open
question the issue flagged as inference rather than proof: **the mismatch does not
clear**. The one attribute React actually reports differing is `inputMode` (`numeric` on
the server, `decimal` on the touch client), which is environment detection inside
`@react-aria/numberfield` rather than anything about duplicate providers. #151 stays open
with the dedup recorded as a real improvement that was not the fix, and the new spec is
`test.fail` rather than allowlisted: Playwright RUNS that test and requires it to fail, so
the day the cause is fixed the run goes red for passing unexpectedly. (`test.fixme`, which
this spec used first, would not have run it at all and so could never have noticed.)
