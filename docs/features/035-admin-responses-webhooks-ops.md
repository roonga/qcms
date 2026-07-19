# 035 — Admin responses, erasure, and webhook operations

**Stage:** 8a (exit gate) · **App:** `apps/admin` · **Depends on:** 034, 023, 025
**References:** **ADR-17** · review resolutions "webhook dead-letter visibility", "erasure admin exposure" · **Wireframe:** `docs/wireframes/admin-responses-ops.md` (042)

## Context

The operational half of authoring: seeing what came in, exporting it, honoring erasure requests, and operating webhook delivery — including the dead-letter queue the reliability story depends on.

## Deliverables

- **Response browser:** per-form paginated list (023's API): submittedAt, version, accessMode, flagged badge; filters (version, date range, flagged). Detail view: locked answers rendered with question labels (resolved from the pinned version), the **answer ledger** timeline (audit view: every change with timestamps), contentHash, link state if secure-link.
- **Flag review:** flagged submissions (honeypot/min-time from 020/026) with reason; unflag action (releases the withheld webhook event per 023) with confirmation explaining the consequence.
- **Export UI:** format (CSV/JSON), version (required for CSV), date range; streams the download; empty-result messaging.
- **Erasure:** on a response detail — "Erase respondent data" with a type-to-confirm dialog (explains ADR-17: irreversible, tombstone remains, webhook consumers unaffected); post-erasure the detail shows the tombstone. Erasure log screen (023's `GET /admin/erasures`) as compliance evidence.
- **Webhook operations:** per-form webhook config UI (024: create with one-time secret reveal, rotate, deactivate); **delivery dashboard**: recent deliveries with status/attempts/latency, and the **dead-letter list** (025) with lastError, attempt history, and per-item redeliver + bulk redeliver; delivery detail shows request headers (signature masked) and response code/body snippet.
- Playwright: browse seeded responses → export CSV → erase one (verify gone from list + tombstone logged) → poison a webhook target → observe dead-letter → fix target → redeliver → delivered.

## Exit criteria

1. The full Playwright operations suite green (it is the 8a stage gate together with 034's suite).
2. Erasure UX: confirm dialog blocks accidental erasure (no single-click path); post-state correct everywhere (list, detail, export, log).
3. Dead-letter → redeliver loop works from the browser against a real failing-then-fixed receiver.
4. Ledger timeline matches `answerLedger` exactly for a session with revised answers.
5. axe pass on all screens in this task.

## Out of scope

Analytics/charts (not the product — Project Goal §8), scheduled exports (issue), webhook payload customization (issue).
