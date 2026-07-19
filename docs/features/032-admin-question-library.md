# 032 — Admin question library

**Stage:** 8a · **App:** `apps/admin` · **Depends on:** 031 (shell), 021 (API)
**References:** `DOMAIN_SCHEMA.md` §4.2 · ADR-02 · R6, R7 (cut-line: manual pinning, no impact analysis) · **Wireframe:** `docs/wireframes/admin-question-library.md` (042)

## Context

The governed question library UI — the product's identity per ADR-02, with deliberately dumb launch UX: create, edit drafts, version, publish, deprecate. No cascade features; the cut-line is enforced at review.

## Deliverables

- **Library list:** searchable/filterable (status, type, slug/label text) table of questions with latest-version summary, status badges (draft/published/deprecated), created/updated timestamps.
- **Question detail:** version timeline (every version, status, publishedAt); read-only rendered view of any version via the shared renderer (single-question preview through a minimal compiled document — reuse 011 in a preview endpoint or compile client-side from the API's definition; choose and document, preserving preview fidelity).
- **Editor** (per type): type picker (locked after creation — changing type is a new question by R6; explain this in the UI); label/help/required; per-type constraint editors (bounds, pattern with live regex feedback, option list editor with stable `optionId`s auto-generated once and immutable thereafter, reorderable labels); live Zod validation surfacing 003's error paths inline.
- **Lifecycle actions** with confirmations that *teach the rules*: publish ("becomes pinnable; content frozen"), new version ("creates draft vN+1"), deprecate ("blocks new pins; existing forms unaffected"). Errors from 021 (e.g. `VERSION_IMMUTABLE`, `QUESTION_ID_REUSED`) rendered as friendly messages.
- `questionId` UX: generated from slug with `q_` prefix, shown prominently, immutability explained at creation time.
- Empty states and the insurance/kitchen-sink seed available in dev (`pnpm qcms:seed-fixtures`) so the UI is explorable.
- Playwright: full lifecycle walk (create each of the 7 types → publish → new version → deprecate) through the browser.

## Exit criteria

1. Playwright lifecycle suite green; every 021 error surfaced somewhere readable (spot-check the main ones).
2. Option editor: optionIds stable across reorder/relabel (assert in test — rules depend on this).
3. Preview renders via the shared renderer (import-surface: no second renderer).
4. axe pass on library, detail, and editor screens.

## Out of scope

Pin management inside forms (033), impact analysis / "where is this used" beyond a simple pinned-by list if the API already affords it cheaply (if not: `phase-4` issue, do not extend the API), bulk import (issue).
