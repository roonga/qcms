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

`@roonga/qcms-db` gains the workspace-theme and logo-store queries, and
`setWorkspaceAppearanceLock`. `upsertDraft` now requires `appearance`, so no save path can
drop a form's appearance by forgetting the field, and `WorkspaceRow` carries
`appearanceLocked`. The logo read selects exactly the three columns an environment role
holds `SELECT` on, because the serving pool answers with it.

`PUT /admin/forms/{id}/draft` accepts `appearance`, validates it against the shared schema
and the WCAG contrast check, and refuses any change to it while the workspace's appearance
lock is set, for every actor and for the assistant alike. An omitted field keeps what the
form already carries, so a client that knows nothing of appearance never clears one and a
save that changes nothing succeeds under the lock. The form read, session start and every
step response carry the appearance of the draft or the pinned version.

A workspace's themes are listed, read, saved, changed and deleted by an Edit forms holder
of that workspace, with the logo uploaded under the SHA-256 of its own bytes into immutable
storage. The lock is set and cleared by a Workspace administrator or a Site administrator,
with no second approver and one `setting` audit row. `GET /logos/{key}` serves the bytes
with no session, the sniffed content type, `nosniff` and a year's immutable cache; the
portal re-serves them from its own origin so SEC-9's `img-src 'self'` holds. A malformed
key, an unknown key and a key stored elsewhere are one uniform 404.

Nothing links a form to a theme: applying one copies its values in, so changing or deleting
a theme afterwards alters no draft and no version, and the logo each carries is still
served. No migration: task 108 holds the columns.
