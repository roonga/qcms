---
"create-qcms-app": minor
---

The scaffolded admin's menus are the vendored `Menu` again (issue #234). The templates
mirror the canonical `apps/admin`, so this carries the same change: the appearance control,
the account control, the builder rail's two step menus and the step editor's move-pin menu
compose the registry component through its new trigger, header, class-name and item slots
instead of composing `react-aria-components`' popup primitives, and
`components/kit.tsx` no longer re-exports those primitives. A new
`components/menu-slots.ts` holds the class names all four share.

An adopter who has customized one of those menus by hand will need to move it to the same
props; nothing else in the scaffold changes.
