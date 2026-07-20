# Response listing, export, and erasure slices (task 023)

The launch-scope **data-out** surface for authors, on the **admin** surface:
browse submitted responses, export them (CSV/JSON), erase a response, and manage
anti-abuse flags. Honest transaction scripts (R5) over the reporting view (015)
and `@qcms/db` helpers (014/016/023). This is **not** the deferred `/api/v1`
(R7) - these are internal admin endpoints with no stability contract.

## Routes

| Method & path                               | Scope (SEC-5)       | Notes                                                                                          |
| ------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /admin/forms/:id/responses`            | `responses:read`    | Paginated submitted responses from `reporting.responses`. Filters: `version`, `from`, `to`, `flagged`. |
| `GET /admin/forms/:id/responses/:sessionId` | `responses:read`    | Full detail: locked answers, the append-only **answer ledger** (audit history), `contentHash`. |
| `GET /admin/forms/:id/export`               | `responses:export`  | `?format=csv\|json&version=&from=&to=`. Streamed (see **Export**).                              |
| `POST /admin/sessions/:sessionId/erase`     | `responses:erase`   | Body `{ reason }`; calls `eraseSession` (016). Returns the tombstone. Idempotent.              |
| `GET /admin/erasures`                        | `responses:read`    | Tombstone list (compliance evidence). Filter: `formId`.                                        |
| `POST /admin/responses/:sessionId/unflag`   | `responses:erase`   | Release a withheld (flagged, 020) response: clear the flag and enqueue `response.submitted`.   |

Scopes are **inert at launch** - the `/api/v1` surface is reserved (R7). They
ride in the generated OpenAPI document so Phase-4 activation is wiring, not
archaeology. The three response scopes are deliberately narrow and **never
bundled into a preset**: `responses:erase` (destructive) is granted on its own.

### The unflag scope (a documented judgement call)

Unflag is a per-response **disposition mutation** - it releases a response that
anti-abuse withheld from webhook delivery. There is no `responses:write` /
`responses:moderate` scope in the launch taxonomy (SEC-5, fixed in 017), so it is
annotated with `responses:erase`: the two per-response disposition mutations
(release vs. destroy) share one deliberately-narrow scope, keeping mutating
authority out of the read/export scopes. A dedicated `responses:moderate` scope
is the right Phase-4 refinement (filed as a discovery), at which point unflag
moves to it - a one-line annotation change, since scopes enforce nothing today.

## Erasure safety (SEC / ADR-17)

Every read path - list, detail, export - goes through `reporting.responses`,
whose **tombstone anti-join** excludes erased (and non-submitted) sessions by
construction. `getResponse` returns `undefined` for an erased session, so detail
404s; the export pages the same view, so an erased response can never leak. No
handler reads raw `submissions`/`answers` content bypassing the view. This holds
independently of erasure's delete path: even before 016 deletes the rows, the
tombstone alone removes the response from every read here.

Erasure is idempotent (016): a repeat erase returns the existing tombstone with
`alreadyErased: true`.

## Export (streamed, fetch-pure)

The export **streams** (never buffers the whole table) using a web
`ReadableStream` and `TextEncoder` - no Node streams (R4) - pulling bounded
keyset pages (`fetchResponsePage`, ordered by `session_id`). Memory is O(page),
not O(table); the 10k-response test asserts the document arrives in many chunks,
none near the whole size.

- **JSON** (`format=json`): a streamed array of `reporting.responses` rows,
  canonical encodings as-is. May span versions (no `version` required).
- **CSV** (`format=csv`): one column per `questionId` of the **requested
  version's** form, in **document order** (walk `steps` then `items`), preceded
  by the metadata columns `session_id, form_version, submitted_at, access_mode`.
  A `version` is **required** - the column set depends on it.
  - **multiChoice** serializes as option ids joined by `;` (e.g.
    `opt_a;opt_b;opt_c`) - a single field, so the `,` delimiter is unambiguous.
  - **RFC 4180 quoting**: a field is quoted when it contains `,`, `"`, CR, or LF;
    embedded quotes are doubled. Records end with **CRLF**.
  - **UTF-8 BOM** is prefixed once. Excel assumes the legacy codepage for a
    BOM-less file and mojibakes non-ASCII answers; the BOM makes it detect UTF-8.
    Other tools ignore it.
  - An unanswered question is an empty cell.

Answer **values are never logged** (SEC-8); the export is the only place answer
content leaves the system on this surface, and only to an authenticated admin.

## Flagged submissions (020) and unflag

A submission flagged at submit is accepted with the usual success response but its
`response.submitted` outbox event is **withheld**. It is still a submitted
response, so it appears in the list/detail/export with its `flaggedReason`.
`POST .../unflag` clears the flag and enqueues the withheld event **in one
transaction** (transactional outbox, §11). The clear is conditional and
race-safe: only the caller that actually flips the flag enqueues the event, so
concurrent or repeated unflags release it **exactly once** (`released: false` on a
no-op).

## Auth seam (real from day one, stubbed until 031)

Identical to the other admin slices: the admin group carries the internal
service-token gate (SEC-4, channel) and the admin-auth gate
(`registerAdminAuth`, user). An unauthenticated request 401s before any handler;
in a public-only process the admin group is not mounted, so these paths 404,
never 403 (ADR-09).

## Notes / follow-ups

- `@qcms/db`'s `sessions` row (enum `access_mode`, branded ids) reads as a TS
  *error* type through the emitted `.d.ts` (issue #5); the unflag handler launders
  its one session read through a narrow view with a single cast on an unannotated
  const. The 023 reporting helpers return explicit clean row types, so their rows
  need no launder.
- Scheduled/automated exports are **out of scope** (Phase 4, R7) - filed as a
  discovery, not built here.
