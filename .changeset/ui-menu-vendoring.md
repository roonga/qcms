---
"@qcms/ui": minor
---

Vendor the a2-react-aria `menu` component and open the kit's menu surface (task
032). `src/components/a2ui/menu/` comes from the pinned registry commit and is
byte-identical to it (`a2ra diff` clean, transcript in `packages/ui/a2ra-diff.md`);
`@qcms/ui/kit` now exports `Menu` and `MenuItemEntry` alongside the other vendored
controls.

The kit also re-exports the react-aria popup primitives the QCMS app's topbar
composes (`MenuTrigger`, `MenuTriggerButton`, `MenuPopover`, `MenuList`,
`MenuItem`, `MenuSeparator`). The vendored `Menu` takes `triggerLabel?: string`
and renders its own bordered pill, so a host that needs an icon or an initials
disc as its trigger, a checked row with a leading glyph, or a non-interactive
header cannot reach that through its props, and ADR-22 forbids editing a vendored
file to get there. Routing the primitives through this package keeps
`react-aria-components` an import of `@qcms/ui` alone, which is the property
ADR-22 protects; the keyboard contract (Enter, Space or Arrow Down opens; arrows
navigate; Escape closes and restores focus) is `MenuTrigger`'s either way and is
asserted for both shapes in `src/menu-keyboard.test.tsx`.

`theme-components.css` gains the menu popover's radius, its rows' radius and
inline padding, and the high-contrast border treatment that already covered the
select's listbox.
