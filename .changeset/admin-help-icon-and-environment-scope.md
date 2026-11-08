---
"create-qcms-app": minor
---

Admin UI clean-up: the help pattern, round controls, the environment's reach and a response's
destructive act.

- The help icon is a drawn disc in a fixed 24px button, with hover, focus and open states, no fill
  in high contrast and a 44px target under a coarse pointer. Its tip keeps the pointer, so it is
  hoverable and persistent, points at its glyph, flips above the fold and clamps to the viewport.
  The glyph sits 4px after the heading it names.
- Round controls carry shared classes that lock both axes, so no row stretches one into an oval.
  The avatar, the Help disc and the copy control keep equal width and height in every theme; the
  appearance trigger is a square ghost icon button, bordered in high contrast.
- The selected environment reaches Operations only: the builder, Rules, Preview and New form load
  and edit the one shared draft whichever environment is selected.
- Erase sits under More actions in a response's page header, which is where destructive acts live.
- `GET /admin/forms/{id}` answers `workflow.canEdit` as the caller's `form: write` and
  `workflow.canPublish` as their `form: publish`, neither following the request's environment.
