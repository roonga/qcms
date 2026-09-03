# Question authoring slices (task 021)

The headless question library, on the **admin** surface. Honest transaction
scripts (R5): the kernel (`@qcms/core` `QuestionDefinition`, 003) validates every
definition; the `@qcms/db` helpers (014) persist. No domain aggregate - the
version lifecycle is a set of single-row state checks this slice owns.

## Routes

| Method & path                                     | Scope (SEC-5)     | Notes                                                                                                                                                                                                               |
| ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/questions`                           | `questions:write` | Create a question + its first draft version. Body: `{ slug, definition }` (the `questionId` lives inside `definition`).                                                                                             |
| `POST /admin/questions/:id/versions`              | `questions:write` | Append a new draft version, seeded from the latest version's definition.                                                                                                                                            |
| `PUT /admin/questions/:id/versions/:v`            | `questions:write` | Edit a **draft** version's definition. Published/deprecated → `VERSION_IMMUTABLE`.                                                                                                                                  |
| `POST /admin/questions/:id/versions/:v/publish`   | `questions:write` | Draft → published (freezes the definition; makes it pinnable).                                                                                                                                                      |
| `POST /admin/questions/:id/versions/:v/deprecate` | `questions:write` | Published → deprecated (blocks **new** pins only; existing pins/history untouched).                                                                                                                                 |
| `GET /admin/questions`                            | `questions:read`  | List with latest-version summary; `?status=` filter, `?search=` over slug/label, `?versions=all` to carry every version of each row.                                                                                |
| `GET /admin/questions/:id`                        | `questions:read`  | One question with every version, oldest first.                                                                                                                                                                      |
| `GET /admin/questions/:id/versions/:v/preview`    | `questions:read`  | Compile one version to a single-question A2UI document (`{ stepId: "stp_preview", root, a2uiSpecVersion, compilerVersion }`) for the admin preview pane. `?locale=` (default `en`, unparseable falls back to `en`). |

## The preview route is not the serving path (ADR-18)

`…/preview` **recompiles** a stored definition on demand - usually an
unpublished draft - so an author can see their question drawn by the shared
renderer (028) while editing it. That is why it lives on the admin group: the
respondent-facing path serves the _stored_ compiled document from a pinned
snapshot and never a recompilation (ADR-18). Nothing the preview produces is
stored, pinned, or reachable from the portal.

The document is wrapped exactly like a compiled step (`Form → Flex(column)`) so
the renderer needs no preview-specific branch, minus two things a real step
carries: no headings (a library question belongs to no form or step here) and
**no honeypot** - the decoy is an abuse control for respondent-facing steps
(026), and an authenticated preview that is never submitted must not carry one.

Scopes are **inert at launch** - the `/api/v1` surface is reserved (R7). They ride
in the generated OpenAPI document so Phase-4 activation is wiring, not archaeology.

## No delete endpoint (R6)

There is deliberately **no delete route**. A `questionId` is stable forever and
never reused with a different meaning (R6), so questions are _deprecated_, never
removed. `POST /admin/questions` rejects any id ever used - including one that
belongs to a deprecated or erased question - via `isQuestionIdTaken`
(`QUESTION_ID_REUSED`, 409). Reuse can never silently change an id's meaning.

## Immutability is returned before the DB trigger

Editing or transitioning a non-draft version is rejected with a typed 409
(`VERSION_IMMUTABLE` for edits, `INVALID_VERSION_STATE` for publish/deprecate)
after reading the current status - **before** the write is attempted. The
`question_versions_freeze_published` trigger (migration 0001) is only the
storage backstop; a client always sees a clean 409, never a 500 surfaced from
the trigger.

## Auth seam (real since 031)

The admin group carries two independent gates, applied in order:

1. **Internal service token** (SEC-4) - authenticates the _channel_; applied to
   every mounted group by the composition root.
2. **Admin auth** (`src/middleware/admin-auth.ts`) - authenticates the _admin
   user_. Installed by `registerAdminAuth`, the first registrar in the admin
   bucket, so it runs before every route here. A request without an admin
   session is rejected **401** before any handler or database access.

The middleware wraps an `AdminSessionVerifier`. Since task 031 that verifier is
`betterAuthSessionVerifier`: the admin BFF forwards the signed-in user's
better-auth **session token** on `x-qcms-admin-session`, and the middleware
resolves it against the deployment's Postgres, rejecting an unknown token, an
idle-expired session, a session past its 12h absolute lifetime, or (unless
`QCMS_ADMIN_2FA=optional`) an account that has not completed TOTP enrollment
(SEC-1). The resolved principal carries the SEC-3 `role` claim and the inert
SEC-5 `scopes`. The API never links better-auth: verification is one row read, so
handlers stay fetch-pure (R4). Auth logic never leaks into a handler.

A test that needs an authenticated admin request seeds a real session row with
`seedAdminSession` (`src/test-support.ts`); there is no longer a marker header any
value satisfies.

In a **public-only** process the admin group is not mounted at all (ADR-09), so
these paths do not exist: a request 404s, never 403s.

## Notes / follow-ups

- `GET /admin/questions` loads each row's latest definition for its label (one
  read per row). Fine at launch admin scale; a JOIN or denormalized label column
  is a Phase-4 optimization (R7), not a launch need. **`?versions=all` does not
  pay that cost**: it reads every version of every listed question in one query
  (`listVersionsForQuestions`) and takes the latest out of what it already has,
  so the versions-bearing variant makes two queries whatever the library's size.
  That asymmetry is deliberate rather than an oversight - issue #684 was about
  the fan-out on the path the form builder uses, and converting the summary path
  as well would change what the library screen loads for no defect anyone has.
- **The versions-bearing response is unbounded**, because this route has no
  pagination at all. It is strictly larger than the summary for the same library,
  and its one caller (`loadPinnableQuestions`, the form builder) needs the whole
  library by construction: the picker offers every pinnable version. Issue #684
  names a search endpoint with counts and pagination as the larger of its two
  options and `add-question-poc.html` assumes one; that remains unbuilt, and this
  is the smaller half it called out as removing the worse problem.
