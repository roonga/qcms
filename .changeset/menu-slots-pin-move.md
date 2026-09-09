---
"@roonga/qcms-ui": minor
---

Move the `a2-react-aria` pin to the `Menu` trigger, header and item slots, and put every
admin menu back on the vendored component (issue #234, upstream
`roonga/a2-react-aria#75`).

Task 032 vendored `menu` for the admin topbar and then did not use it. The registry
component rendered its own bordered pill trigger from a `string` and its own
`{ id, label: string }` rows, and the frozen design card
(`plan/admin-theme/ds-navbar.html`) asks for a trigger that is an SVG glyph or an initials
disc, a menu with its own `aria-label`, a checked row carrying a check glyph beside its
text, a non-interactive "Signed in as" header and a separator. ADR-22 forbids editing a
vendored file to reach any of that, so `@roonga/qcms-ui/kit` re-exported
`react-aria-components`' popup primitives under menu-flavoured names and four admin
surfaces composed those directly. That was ADR-22-legal and it was still a divergence: the
registry component was bypassed exactly where a design system most wants to be the single
source of the shape.

ADR-22's rule for a shortfall in a vendored component is to fix it upstream and never fork
it here, so the pin now carries the slots: `trigger`, `menuLabel`, `header`, `classNames`
and `disallowEmptySelection` on the component, and `textValue`, `href` and a `separator`
kind on an item whose `label` widened from `string` to `ReactNode`. All additive; the
vendored bytes are byte-identical to upstream at the pin, proved by `check:a2ra-fidelity`,
by `a2ra diff`, and independently by git tree hash in `packages/ui/a2ra-diff.md`.

`classNames` is what makes adoption possible without a variant layer growing in this
package: a host names the classes for the trigger, popover, menu, item, header and
separator slots and its names REPLACE the component's defaults, so the admin's
`.qcms-menu*` rules land on exactly the elements they landed on before.

**The kit's menu primitives are gone.** `MenuTrigger`, `MenuTriggerButton`, `MenuPopover`,
`MenuList`, `MenuItem` and `MenuSeparator` are no longer exported from
`@roonga/qcms-ui/kit`; `Menu` is the one door to a menu, and `MenuActionEntry`,
`MenuClassNames`, `MenuItemEntry` and `MenuSeparatorEntry` are exported beside it. The four
admin surfaces that composed them - the appearance control, the account control, the
builder rail's two step menus and the step editor's move-pin menu - are the vendored
`Menu` now. The keyboard contract is unchanged in every one of them, because it was always
`MenuTrigger`'s and the vendored component is a thin composition of exactly the primitives
that were exported.

The pin also carries an `@a2ra/cli` fix found while capturing the transcript: `a2ra diff`
decided whether a file had moved by scanning its own rendered output for `"- "` and `"+ "`,
which also occur in prose, so any component whose source contains a spaced hyphen reported
as drifted forever. The new `Menu` prop documentation is the first registry source to
contain one.
