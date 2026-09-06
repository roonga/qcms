---
"@roonga/qcms-ui": patch
---

Move the `a2-react-aria` pin (ADR-22 reviewed event) so three vendored controls arrive
fixed at their cause: issues #804, #789 and #793, one upstream change
(roonga/a2-react-aria#78) and one pin move.

`TextField` no longer discards what a person typed before React attached. react-aria
renders a CONTROLLED input whatever it is handed, so the commit that hydrated the field
wrote its own empty initial state onto the DOM. On the admin's `required` six-digit code
field the loss was silent and total: the browser's own constraint validation then refused
the submit, with no submit event, no request and nothing on screen, which is the
operator-facing half of #210 (12 wipes in 20 trials on an idle machine, React attaching
76-404ms after the document commit). The vendored control now seeds its initial value from
its own server-rendered input during the hydrating render, adopting only a value that
differs from what the server rendered and never touching a controlled field.

`NumberField`'s required marker is `aria-hidden`, so its accessible name reads as the
question instead of ending in " *". That is the one difference the conformance snapshot
moves: fourteen entries lose a trailing asterisk and nothing else changes.

A required `CheckboxGroup` now conveys its state to assistive technology. The vendored
`Checkbox` defaulted `isRequired` to `false` and passed it down, and react-aria resolves a
group item's required state as `props.isRequired ?? state.isRequired`, so the literal
`false` won over the group and a required multiChoice said nothing beyond a `data-required`
styling hook. ARIA does not allow `aria-required` on `role="group"`, so the state sits on
the items, for exactly as long as nothing in the group is selected.

`packages/ui/a2ra-manifest.json` and `packages/ui/a2ra-diff.md` are regenerated at the new
pin. `group-schema-fields.ts` now arrives through the registry rather than by a mapping in
`scripts/check-a2ra-fidelity.mjs`, because upstream's registry generator follows a
component's imports out of its own directory: at the old pin the file was in no registry
item, so a consumer running `a2ra add checkbox` received source with a dangling import.
`UPSTREAM_REPO_SOURCES` is now empty.
