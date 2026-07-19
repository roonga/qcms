# 019 — get-step and submit-answer slices

**Stage:** 6 · **App:** `apps/api` · **Depends on:** 018 (and kernel 006/009)
**References:** `ARCHITECTURE.md` §5.2 · **ADR-18** (serve audit copy) · I5, I6 · R3, R5

## Context

The serving loop: fetch the current step's stored compiled A2UI plus flow state; accept an answer, validate through the kernel, append to the ledger, re-evaluate. The BFF (029) proxies these verbatim — all authority is here and in the kernel.

## Deliverables

- `GET /sessions/:id/step` (session-token authed):
  - Load session (reject `submitted`/`expired` with typed codes) → load pinned `form_versions` row → `latestAnswers` → `evaluateRules` → respond `{ step: <stored compiled A2UI document for currentStep>, flowState: <client-safe projection>, progress: { stepIndex, totalVisibleSteps } }`.
  - **Serve the stored `compiled` JSONB — never recompile** (ADR-18). Include the snapshot's `a2uiSpecVersion` so the renderer selects the right handling.
  - `flowState` sent to clients is a projection (visible questions of the current step, missing-required); do not leak the full rule graph or hidden-question inventory.
  - Completed flow (no current step, not yet submitted) → `{ step: null, readyToSubmit: true, missingRequired: [] }`.
- `POST /sessions/:id/answers` — body `{ questionId, value }`:
  1. Session active; question exists in pinned snapshot (`UNKNOWN_QUESTION` otherwise); question **currently visible** (answering hidden questions rejected `QUESTION_NOT_VISIBLE` — the ledger records only answers that were legitimately givable).
  2. `validateAnswer` (009) against the pinned question version → 422 with the kernel's error list on failure.
  3. `appendAnswer` (insert-only), mark session `in_progress`, re-evaluate, return updated flow projection (the portal re-renders branching from this response).
  - Answer writes for a session are serialized (advisory lock on sessionId or equivalent) so ledger order is meaningful.

## Exit criteria

1. Branching loop test: answer `q_smoker=true` → response's flow shows `q_cigs_daily`; answer it; set `q_smoker=false` → follow-up disappears; ledger holds all three rows; `latestAnswers` reflects latest.
2. Served step deep-equals the stored golden compiled document for the fixture (proves no recompilation).
3. Invalid value → 422 with kernel codes; hidden question → `QUESTION_NOT_VISIBLE`; unknown → `UNKNOWN_QUESTION`; submitted/expired session → typed reject.
4. Concurrency: two simultaneous answers to one session both land, ledger order deterministic.

## Out of scope

Submission (020), abuse limits (026), rendering (028/029).
