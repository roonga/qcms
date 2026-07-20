# Question authoring slices (task 021)

The headless question library, on the **admin** surface. Honest transaction
scripts (R5): the kernel (`@qcms/core` `QuestionDefinition`, 003) validates every
definition; the `@qcms/db` helpers (014) persist. No domain aggregate — the
version lifecycle is a set of single-row state checks this slice owns.

## Routes

| Method & path | Scope (SEC-5) | Notes |
|---|---|---|
| `POST /admin/questions` | `questions:write` | Create a question + its first draft version. Body: `{ slug, definition }` (the `questionId` lives inside `definition`). |
| `POST /admin/questions/:id/versions` | `questions:write` | Append a new draft version, seeded from the latest version's definition. |
| `PUT /admin/questions/:id/versions/:v` | `questions:write` | Edit a **draft** version's definition. Published/deprecated → `VERSION_IMMUTABLE`. |
| `POST /admin/questions/:id/versions/:v/publish` | `questions:write` | Draft → published (freezes the definition; makes it pinnable). |
| `POST /admin/questions/:id/versions/:v/deprecate` | `questions:write` | Published → deprecated (blocks **new** pins only; existing pins/history untouched). |
| `GET /admin/questions` | `questions:read` | List with latest-version summary; `?status=` filter, `?search=` over slug/label. |
| `GET /admin/questions/:id` | `questions:read` | One question with every version, oldest first. |

Scopes are **inert at launch** — the `/api/v1` surface is reserved (R7). They ride
in the generated OpenAPI document so Phase-4 activation is wiring, not archaeology.

## No delete endpoint (R6)

There is deliberately **no delete route**. A `questionId` is stable forever and
never reused with a different meaning (R6), so questions are *deprecated*, never
removed. `POST /admin/questions` rejects any id ever used — including one that
belongs to a deprecated or erased question — via `isQuestionIdTaken`
(`QUESTION_ID_REUSED`, 409). Reuse can never silently change an id's meaning.

## Immutability is returned before the DB trigger

Editing or transitioning a non-draft version is rejected with a typed 409
(`VERSION_IMMUTABLE` for edits, `INVALID_VERSION_STATE` for publish/deprecate)
after reading the current status — **before** the write is attempted. The
`question_versions_freeze_published` trigger (migration 0001) is only the
storage backstop; a client always sees a clean 409, never a 500 surfaced from
the trigger.

## Auth seam (real from day one, stubbed until 031)

The admin group carries two independent gates, applied in order:

1. **Internal service token** (SEC-4) — authenticates the *channel*; applied to
   every mounted group by the composition root.
2. **Admin auth** (`src/middleware/admin-auth.ts`) — authenticates the *admin
   user*. Installed by `registerAdminAuth`, the first registrar in the admin
   bucket, so it runs before every route here. A request without an admin
   session is rejected **401** before any handler or database access.

The middleware is a **real seam with a permissive stub**. It wraps an
`AdminSessionVerifier`; today `stubAdminSessionVerifier` treats any non-empty
`x-qcms-admin-session` header as an authenticated admin (scopes inert). Task 031
swaps in real better-auth session (cookie) verification and 2FA policy (SEC-1) at
`makeAdminAuth` — a one-line change, no handler or route touched. Auth logic
never leaks into a handler.

In a **public-only** process the admin group is not mounted at all (ADR-09), so
these paths do not exist: a request 404s, never 403s.

## Notes / follow-ups

- `GET /admin/questions` loads each row's latest definition for its label (one
  read per row). Fine at launch admin scale; a JOIN or denormalized label column
  is a Phase-4 optimization (R7), not a launch need.
