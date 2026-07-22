# 045 - Portal step navigation: explicit cursor (Continue / Back / Submit)

**Stage:** 7 · **Apps/packages:** `apps/portal` (029), `@qcms/ui` (028), `apps/api` (serve-step) · **Depends on:** 029 · **Blocks:** 030 (manual a11y pass)
**Runs:** now, before 030's manual screen-reader pass. **On the launch gate** - the portal flow must complete end-to-end.
**References:** ADR-28 (proposed 2026-07-23, pending Ravi's decision - this task implements it) · 042 wireframe (Back control) · ADR-23 (testing architecture: Playwright e2e over the real stack + Docker Postgres) · ADR-26 (portal SSR-first, fetch-only) · R2 (strict BFF; the portal never evaluates rules) · WCAG 2.2 AA (3.2.2 On Input) · manual review 2026-07-23 findings M/N/G/H + E/L/B · `packages/core/src/evaluate-rules.ts:388-414` (derived `currentStep` - the root cause) · `apps/portal/components/step-flow.tsx:356` (collapse-on-answer render).

> **e2e is a full-stack integration test, not a UI test.** The portal e2e drives the real
> stack - browser -> portal BFF -> API -> Postgres in Docker (ADR-23). Exit criteria 4-5 below
> therefore verify the **server and database**, not just the rendered page: the persisted
> response must independently match what the respondent entered, and the API/DB container logs
> must be clean. We are testing the API and DB through this flow as much as the portal.

## Context

Manual review (2026-07-23) found the portal flow cannot be completed reliably. Root cause: the "current step" is **derived**, not committed. `evaluate-rules.ts` computes `currentStep` as the first step still holding an unanswered required question, and the portal renders exactly that step (`step-flow.tsx:356`), so navigation is a side effect of validation state:

- **M (S1):** a multi-choice question collapses after the first selection - ticking one option satisfies "required", `currentStep` advances, and the question vanishes before the respondent can pick more.
- **N (S1):** the final-step Submit sends the respondent back to an earlier step when revalidation or a branch re-opens a required question there (`currentStep` recomputes backward).
- **G:** no Back control, despite the signed 042 wireframe (Back, secondary, absent on the first step).
- **H:** auto-forward is not a choice the form admin can make.

ADR-28 replaces the derived cursor with explicit, user-driven navigation. This also violated WCAG 3.2.2 (On Input): a selection caused a context change with no explicit user action.

## Deliverables

- **Explicit navigation (portal, 029):** a committed step cursor. **Continue** advances to the next visible step *only* when the current step's required questions are satisfied (otherwise show the existing error summary and do not advance); **Back** returns to the previous visible step (hidden on the first step, per 042); **Submit** appears only on the final visible step. A step never collapses or advances as a side effect of answering.
- **Per-answer posting unchanged (R2):** answering still posts to the API, which re-evaluates and owns validation/projection; branch insert/remove *within the current step* still reflects live and is announced (030's live regions/focus policy). Only Continue/Back change the rendered step.
- **Serve-step by cursor (api):** if serve-step today returns only the first-incomplete step, extend it to return a *requested* visible step document (by id/index) for rendering. R2 preserved: the portal requests and renders; it performs no rule evaluation. `flowState` (`currentStep`/`readyToSubmit`/`missingRequired`) remains the validation authority the portal reads to gate Continue/Submit.
- **Auto-advance deferred as opt-in (schema stub only):** do **not** auto-advance by default. If cheap, reserve a per-form `advanceOnComplete` setting defaulting `false` in the schema (finding H). The builder UI toggle and the date-segment auto-advance option are a later admin task - do not build them here.
- **Back + append-only:** revisiting an answered step shows the stored answers; changing an answer posts a new append-only answer (R3 / ADR-17), never a mutation. Confirm resume still holds.

## Exit criteria (CI-enforced unless noted)

1. **Full-flow kitchen-sink e2e:** a Playwright spec drives the seeded kitchen-sink form (all seven question types incl. multi-choice + date): start -> through every step via Continue -> Submit -> completion receipt renders. Multi-choice: selecting 2+ options keeps all selections (guards M). Final Submit completes without regressing to an earlier step (guards N). Back from step *k* returns to *k-1* with prior answers shown (guards G).
   - **Fixture content is vehicle-insurance-domain only - no health/medical or other sensitive topics.** The kitchen-sink fixture is new in this task, so 043's neutral-domain rename did not cover it; the current draft wrongly uses medical content (a `Relevant medical history` long-text and a `preexisting conditions` multi-choice with Diabetes/Asthma), which reintroduces exactly the triggering health topics 043 removed. Re-theme those questions to vehicle content while keeping the seven-type coverage - e.g. multi-choice -> optional cover (breakdown / windscreen / legal) or vehicle security features (alarm / immobiliser / tracker); long-text -> vehicle modifications or free-text driving-history detail. Keep the same fixture used by `pnpm dev:portal` consistent with this (one definition).
2. **Three viewports:** the flow + axe + keyboard specs run as Playwright projects at phone (~390x844), tablet (~768x1024), and desktop (~1280x800) - finding L. (Only mobile-chromium runs today; add tablet + desktop.)
3. **Browser console-error gate:** every portal e2e fails on any browser `console.error` / `pageerror` / React hydration warning - finding B. This also surfaces the CSP-nonce hydration mismatch (finding A): fix it or ticket it so the suite is green.
4. **Independent DB verification (API + DB write path):** after submit, the spec opens its **own** Postgres connection to the e2e database and asserts, without trusting the API's response echo: (a) each stored answer equals what the respondent entered, in canonical form, for every question type touched (multi-choice array, date, number, text, boolean, choices); (b) answers are **append-only** - changing an answer via Back adds a new row, it does not update in place (immutability / ADR-17); (c) the submission is locked with `submittedAt` and a `contentHash` present (auditability). A mismatch fails the test. This is the primary proof that the flow persists correctly, not just renders.
5. **Server-side log gate (API + Postgres + portal server):** the spec captures the API, Postgres, and portal-server container logs for the run window and fails on any `error`/`warn`-level line (a documented, reviewed allowlist only if a benign line is genuinely unavoidable). This is the server-side complement to the browser console-error gate: we are testing the API and DB, so their logs must be clean too.
6. **Kitchen-sink in the a11y suites:** axe + keyboard + lighthouse run against the kitchen-sink flow states, not only the 2-question insurance fixture - finding E.
7. **No regressions:** the existing portal e2e (anonymous-flow, resume, secure-link, no-js-submit, ssr-no-js) stays green; the no-JS path (044) still completes through the new navigation.
8. **ADR-28 respected:** navigation is explicit; no collapse-on-answer; the R2 import-surface test still passes (portal imports only *types* from `@qcms/core`).

## Out of scope

The `advanceOnComplete` builder UI and date input-mode/segment toggles (later admin task, finding H); custom per-question error messages (findings C/D); portal header brand config (finding J); managed theming (finding K); the broader hardcoded-text audit (separate task under ADR-27). Fix or ticket finding A only as far as exit-3 requires.
