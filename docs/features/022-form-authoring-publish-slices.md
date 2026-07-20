# 022 - Form authoring and publish slices

**Stage:** 6 · **App:** `apps/api` (`features/forms/*`, `/admin` group) · **Depends on:** 021, 008, 011
**References:** `DOMAIN_SCHEMA.md` §4.1 · ADR-01/02/14, **ADR-16, ADR-18** · I1–I3 · R1, R5

## Context

Draft CRUD is transaction script; **publish is the aggregate** - the one slice that calls `compileDraft`, attaches compiled A2UI, and persists the immutable snapshot. This is where kernel and compiler meet storage for the first time.

## Deliverables

- `POST /admin/forms` (create: formId, slug, defaultLocale, empty draft) · `GET /admin/forms` (list with draft/published status) · `GET /admin/forms/:id` (detail + versions summary).
- `PUT /admin/forms/:id/draft` - replace draft definition; body parsed by `FormDefinition` (004; parse-level errors → 422). Additionally runs **advisory validation** - the full 008 validation in dry-run - returning `{ draft, issues: PublishError[] }` so the admin editor (033) shows live feedback. Advisory issues do not block saving (drafts may be temporarily inconsistent); they block publishing.
- `POST /admin/forms/:id/draft/validate` - dry-run only (no save); used by editor debounce.
- `POST /admin/forms/:id/publish`:
  1. Load draft + question lookups (published versions only; deprecated versions rejected for **new** pins vs the previous published version's pins - a pin unchanged from vN may stay on a deprecated version; a *new or moved* pin to a deprecated version → `DEPRECATED_PIN`).
  2. `compileDraft` (008) → on error, 422 with the full `PublishError[]` verbatim (034 renders these).
  3. `compileForm` (011) on the frozen snapshot.
  4. One transaction: `insertFormVersion` (definition + compiled + compilerVersion + a2uiSpecVersion + semanticsVersion) · delete draft · `enqueue(tx, form.published)`.
  5. Response: `{ version, publishedAt }`.
- `POST /admin/forms/:id/close` / `reopen` - closes to *new* sessions (018 checks); in-flight sessions finish (R1).
- `GET /admin/forms/:id/versions/:v` - full snapshot (definition + compiled) for version history (034).
- New draft after publish seeds from the latest published version.
- Annotate every route with its intended `/api/v1` scope in route metadata (SEC-5: `forms:read` for reads, `forms:write` for draft/publish/close) - inert at launch; exists so Phase-4 activation is wiring, not archaeology.

## Exit criteria

1. Full loop: create → draft → publish → new draft seeded → publish v2; sessions on v1 unaffected (pin test with 018).
2. Publish failure: draft with a backward rule target → 422 listing `RULE_BACKWARD_TARGET` with path; nothing persisted (no version row, draft intact, no outbox event).
3. Deprecated-pin: moved pin to deprecated version rejected; carried-over pin allowed.
4. Snapshot integrity: stored compiled JSONB deep-equals fresh `compileForm` output at publish time; version stamps present.
5. Atomicity under induced failure between version insert and draft delete.

## Out of scope

Question endpoints (021), response listing (023), admin UI (033/034), auto-upgrade/impact analysis (R7).
