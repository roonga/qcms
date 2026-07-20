# 023 - Response listing, export, and erasure slices

**Stage:** 6 · **App:** `apps/api` (`features/responses/*`, `/admin` group) · **Depends on:** 020, 016
**References:** ADR-10, **ADR-17** · `ARCHITECTURE.md` §4.3

## Context

The launch-scope data-out surface for authors: browse, export, erase. Transaction scripts over the reporting view and helpers; the deferred `/api/v1` (R7) is *not* this - these are internal admin endpoints with no stability contract.

## Deliverables

- `GET /admin/forms/:id/responses` - paginated submitted responses (from `reporting.responses`): sessionId, formVersion, submittedAt, accessMode, flagged status (020), answer preview. Filters: version, date range, flagged.
- `GET /admin/forms/:id/responses/:sessionId` - full detail: locked answers, and the **answer ledger** (history with timestamps - the audit view), contentHash.
- `GET /admin/forms/:id/export?format=csv|json&version=&from=&to=`:
  - **JSON:** array of reporting rows, canonical encodings as-is.
  - **CSV:** one column per questionId of the *requested version's* form (stable order = document order); multiChoice serialized `a;b;c` (documented); proper RFC 4180 quoting; UTF-8 BOM (Excel interop - document why). Export streams (no full-table buffering) but stays fetch-pure - use web `ReadableStream`.
  - Version parameter required for CSV (columns depend on it); JSON may span versions.
- `POST /admin/sessions/:sessionId/erase` - body `{ reason }`; calls `eraseSession` (016); returns the tombstone. Idempotent per 016.
- `GET /admin/erasures` - tombstone list (compliance evidence).
- Flagged submissions (020): visible with flag reason; `POST /admin/responses/:sessionId/unflag` releases the withheld `response.submitted` outbox event (enqueue on unflag).
- Annotate every route with its intended `/api/v1` scope in route metadata (SEC-5: `responses:read` for list/detail, `responses:export` for export, `responses:erase` for erasure - never bundled into presets) - inert at launch; exists so Phase-4 activation is wiring, not archaeology.

## Exit criteria

1. List/detail/filter tests over seeded fixture responses, erased sessions absent.
2. CSV: golden export for the insurance fixture (quoting, BOM, multiChoice, column order asserted byte-for-byte); JSON round-trips canonical values.
3. Streaming: exporting 10k seeded responses completes without O(n) memory (heap assertion or streamed-chunks test).
4. Erase → subsequent list/detail/export exclude the session; tombstone listed; unflag → outbox event appears.

## Out of scope

Admin UI (035), `/api/v1` (R7), scheduled/automated exports (Phase 4 idea → issue).
