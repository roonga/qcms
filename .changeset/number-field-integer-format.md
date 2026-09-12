---
"@roonga/qcms-ui": patch
---

An integer number question renders as an integer field, which also ends the NumberField
hydration mismatch on reload (issue #151).

**What was wrong.** Reloading a portal step holding a NumberField logged a React
hydration attribute mismatch on every touch client. Two earlier passes eliminated the
leading explanations (a react-aria-components version regression, then two copies of
react-aria-components in the portal's closure) and the reload spec, run with its
`test.fail` marker off, reduced the diff to exactly one attribute:
`inputMode="decimal"` from the client against `inputMode="numeric"` from the server. The
`role` and `aria-value*` nulls the issue was opened for are printed by React as unchanged
context on both sides, not as the difference, and the no-JS rendering is a separate native
form that is never hydrated, so it was never affected.

**The cause, stated at the level the fix acts on.** `@react-aria/numberfield` picks the
input's `inputMode` from two things: the resolved `Intl.NumberFormat` options, and
platform detection that reads `navigator`. A server render has no `navigator`, so it
always emits `numeric`. The format half is QCMS's own: a number question constrained to
integers compiles to `step: 1`, but react-aria reads the FORMAT rather than the step, and
the default format admits three fraction digits. So an integer-only question shipped a
field that accepted "2.5" while typing and snapped it at commit, asked for a decimal
keypad on touch, and disagreed with its own server render about `inputMode`.

**The fix.** The qcms NumberField adapter in `packages/ui/src/registry.tsx` now declares
`maximumFractionDigits: 0` for a question whose `step` is an integer. The rendered field
then says what the question already meant - no fraction digits parsed, displayed, or
offered - and with no fraction digits in the format every platform branch inside
`useNumberField` leaves `inputMode` at `numeric`, which is what the server emits. The two
renders agree by construction. Nothing is allowlisted and no vendored byte moves: ADR-22
keeps `packages/ui/src/components/a2ui/**` byte-identical to upstream.

**What is still open, and where its marker lives.** A question that ADMITS fractions still
resolves `decimal` on touch against the server's `numeric`, and a negative-admitting one
resolves `text` on an iPhone. Pinning `inputMode` for those needs a prop on the `<Input>`
that the vendored control does not forward - react-aria's `useNumberField` overwrites any
`inputMode` a caller passes to the field, and only a prop on the `<Input>` itself wins,
because that is where react-aria-components merges a caller's props over the field's
context. That is an upstream change in the sibling a2-react-aria checkout plus a pin move.
`packages/ui/src/number-input-mode.test.tsx` puts the adapter through a server render and
a client render for both kinds of question and carries a self-arming `it.fails` marker for
the fractional half, so the day the passthrough lands the suite says so. The earlier
changesets in this release that record #151 as open describe the state at their own
commits; this is the one that closes the reported defect.

**Coverage.** `apps/portal/e2e/resume.pw.ts` reloads the step holding the kitchen sink's
number question under the console gate, and its `test.fail` marker is gone, so the
mismatch is a live merge gate rather than an expected failure. The jsdom suite pins the
rule for both question kinds and three platform positions.
