# Form authoring + publish slices (task 022)

The form library, on the **admin** surface. Draft CRUD is honest transaction
script (R5); **publish is the aggregate** - the one slice where the kernel
(`@qcms/core` `compileDraft`, 008), the compiler (`@qcms/a2ui-compiler`
`compileForm`, 011), and storage (`@qcms/db`, 014) meet: it freezes an immutable
snapshot, projects it to A2UI, and persists version + compiled + stamps in one
transaction. Publish compiles **once** and stores the result (ADR-18); the serve
path (019) reads the stored compiled A2UI and never recompiles - this slice is
the *only* caller of `compileForm`.

## Routes

| Method & path | Scope (SEC-5) | Notes |
|---|---|---|
| `POST /admin/forms` | `forms:write` | Create a form identity + an empty draft. Body: `{ formId, slug, defaultLocale }`. |
| `GET /admin/forms` | `forms:read` | List forms with draft/published status. |
| `GET /admin/forms/:id` | `forms:read` | Detail: identity, the current draft (open, else **seeded** from the latest published version), version summary. |
| `PUT /admin/forms/:id/draft` | `forms:write` | Replace the draft definition (kernel-parsed, 004; parse errors → 422). Returns `{ draft, issues }` - advisory validation for the editor. Issues never block saving; they block publishing. |
| `POST /admin/forms/:id/draft/validate` | `forms:write` | Dry-run publish validation (no save) for editor debounce. |
| `POST /admin/forms/:id/publish` | `forms:write` | The aggregate (below). |
| `POST /admin/forms/:id/close` | `forms:write` | Close to **new** sessions; in-flight sessions finish on their pinned version (R1). |
| `POST /admin/forms/:id/reopen` | `forms:write` | Reopen a closed form. |
| `GET /admin/forms/:id/versions/:v` | `forms:read` | One published version's full snapshot (definition + compiled) for version history (034). |

Scopes are **inert at launch** - the `/api/v1` surface is reserved (R7). They ride
in the generated OpenAPI document so Phase-4 activation is wiring, not archaeology.

## Publish (the aggregate)

1. Load the draft; re-parse it through `FormDefinition` (a draft may be
   temporarily inconsistent - a malformed draft is a 422, never a 500).
2. Load the pinned question versions and build the two lookups `compileDraft`
   needs: `resolveQuestion` and `publishedQuestionVersions` (published versions
   only, R1).
3. **Deprecated-pin gate** (below), then `compileDraft` (008). On any issue →
   **422 `PUBLISH_REJECTED`** with the full issue list **verbatim** (all errors,
   never first-only; 034 renders them). Nothing is persisted.
4. `compileForm` (011) on the frozen snapshot.
5. **One transaction**: `insertFormVersion` (definition + compiled +
   `compilerVersion` + `a2uiSpecVersion` + `semanticsVersion`) · `deleteDraft` ·
   `enqueue(tx, "form.published")`. A version is never observed without its
   event, and the draft never lingers past its publish (transactional outbox,
   §11).
6. Response: `{ version, publishedAt }`.

Nothing is persisted on a failed publish, and nothing is persisted if the
transaction rolls back (an induced failure between the version insert and the
draft delete leaves no version, an intact draft, and no outbox event - exit
criterion 5). The stored `form_versions` row is immutable (R1, I1, ADR-18): this
slice never issues an UPDATE against it, and the `form_versions_reject_update`
trigger (migration 0001) is the storage backstop.

## Deprecated-pin gate (new/moved vs carried-over)

A deprecated question version may **stay** pinned only if the *exact placement*
`(step, question, version)` was already in the **previous published version** - a
carried-over pin the author did not touch. A **new** pin (no prior published
version, or this placement is not in it) or a **moved** pin (same version, now in
a different step) to a deprecated version is rejected `DEPRECATED_PIN`.

`DEPRECATED_PIN` is a slice-level issue the kernel does not model (`compileDraft`
knows only published/not-published). Every pinned deprecated version is added to
`publishedQuestionVersions` so `compileDraft` treats it as resolvable
published-once content - leaving this gate the *sole* author of the deprecation
verdict, so a rejected pin is reported once, as `DEPRECATED_PIN`, never doubled as
`UNPUBLISHED_QUESTION_PIN`.

## New draft after publish is seeded

Publish deletes the draft. `GET /admin/forms/:id` then returns the draft **seeded
from the latest published version** (`draftSource: "seeded"`) - a read-time
convenience so the editor opens pre-populated (§4.1 "new draft opened, seeded from
vN"). It is not persisted until the author saves it with `PUT .../draft`.

## Auth seam (real from day one, stubbed until 031)

Identical to the questions slice: the admin group carries the internal
service-token gate (SEC-4, channel) and the admin-auth gate
(`src/middleware/admin-auth.ts`, user), installed by `registerAdminAuth` - the
first registrar in the admin bucket, reused here. An unauthenticated request 401s
before any handler; in a public-only process the admin group is not mounted at
all (ADR-09), so these paths 404, never 403.

## Notes / follow-ups

- `GET /admin/forms` reads each row's draft + latest version (one read per row).
  Fine at launch admin scale; a denormalized status column is a Phase-4
  optimization (R7), not a launch need.
- `@qcms/db`'s enum-bearing (and branded-id) row types resolve to a TS *error*
  type through the emitted `.d.ts` (issue #5). Reads are laundered through narrow
  local views with a single cast on an unannotated const - the sanctioned
  pattern; do not "fix" `@qcms/db` here.
