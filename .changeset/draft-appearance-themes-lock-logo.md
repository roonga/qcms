---
"@roonga/qcms-core": minor
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Carry a form's appearance through the draft, enforce the workspace appearance lock on the
one draft save path, and serve a stored logo to respondents (task 109, criteria 118, 120,
121, 122 and 124).

`@roonga/qcms-core` gains `sniffRasterLogo` and `RASTER_LOGO_CONTENT_TYPES`: the type a
logo's bytes themselves declare, matched from offset zero so a caller's content type is
never believed and an SVG, a polyglot or any other container is refused rather than stored
as an image.

`@roonga/qcms-db` gains the workspace-theme and logo-store queries,
`setWorkspaceAppearanceLock`, `getWorkspaceForShare` and the logo takedown pair
(`clearThemeLogoKey`, `takeDownAppearanceLogo`, `isLogoTakenDown`). `upsertDraft` now requires `appearance`, so no save path can
drop a form's appearance by forgetting the field, and `WorkspaceRow` carries
`appearanceLocked`. The logo read selects exactly the three columns an environment role
holds `SELECT` on, because the serving pool answers with it.

`PUT /admin/forms/{id}/draft` accepts `appearance`, validates it against the shared schema
and the WCAG contrast check, and refuses any change to it while the workspace's appearance
lock is set, for every actor and for the assistant alike. The lock is read `FOR SHARE`
inside the save's own transaction, so a lock committed beside a save cannot be missed. A
draft may name only a logo already in the store, as a theme may. A request carrying an
assistant proposal token may not carry an appearance at all until task 117 binds it in the
digest (SEC-17, Code Owner, 2026-11-16). An omitted field keeps what the
form already carries, so a client that knows nothing of appearance never clears one and a
save that changes nothing succeeds under the lock. The form read, session start and every
step response carry the appearance of the draft or the pinned version.

A workspace's themes are listed, read, saved, changed and deleted by an Edit forms holder
of that workspace, with the logo uploaded under the SHA-256 of its own bytes into immutable
storage. The lock is set and cleared by a Workspace administrator or a Site administrator,
with no second approver and one `setting` audit row. `GET /logos/{key}` serves the bytes
with no session, the sniffed content type, `nosniff`, an `ETag` that is the key and
`public, max-age=86400, must-revalidate`; the portal re-serves them from its own origin so
SEC-9's `img-src 'self'` holds. A malformed key, an unknown key and a key stored elsewhere
are one uniform 404.

Nothing links a form to a theme: applying one copies its values in, so changing or deleting
a theme afterwards alters no draft and no version, and the logo each carries is still
served.

`DELETE /admin/logos/{key}` takes a stored logo down, and a Site administrator alone may
call it (Code Owner, 2026-11-16, revising the 108 ruling that no role may ever delete a
logo). It clears the key off every theme that named it, deletes the bytes and writes one
`logo` row in the site audit, the fifth kind, mirrored into each workspace whose themes
lost the logo. Migration 0012 adds the mechanism: a `SECURITY DEFINER` function the control
role alone may execute, a delete trigger that admits a row only from inside that function's
own call frame, and a tombstone table that refuses the same bytes from then on
(`LOGO_TAKEN_DOWN`, 409). No application role gains `DELETE` on
`control.appearance_logos`, and `UPDATE` is still rejected for every role.
