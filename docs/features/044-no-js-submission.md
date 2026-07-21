# 044 - No-JS submission (progressive enhancement)

**Stage:** 7 · **Package/App:** `@qcms/ui` (028) + `apps/portal` (029) · **Depends on:** 028, 029
**Runs:** any time after 029; **off the launch gate** (respondents run JS; the SSR-content promise is already kept). Numbered out of sequence - see `features/README.md`.
**References:** 029 exit criterion 2 (the waived no-JS-submission clause) · ADR-18 (serve the stored compiled doc verbatim) · ADR-26 (portal is SSR-first, fetch-only) · `apps/portal/README.md` "Known limitation: no-JS submission" · issue #17 · the 029 review.

## Context

029 landed SSR-first with real server-rendered step content on first paint **with JS disabled** (verified live), but the no-JS *submission* half of its exit criterion 2 was **explicitly waived by Ravi at 029 land (2026-07-22)** so the portal could land on the JS path. This task closes that gap: a respondent with JavaScript disabled must be able to complete and submit a form, page-reload per step.

**Why it was deferred (a real cross-package dependency, not a scope cut).** The `@qcms/ui` a2ra renderer (028) owns the step `<form>`, and the stored compiled A2UI document (served verbatim, ADR-18) carries no form `action`/`method` and no submit control. The portal's primary button is rendered outside the renderer as `type="button"`, and the only answer endpoint accepts per-question JSON (`{ questionId, value }`), not a form-encoded whole-step POST. So a radio-only step has nothing to submit without JS.

## Deliverables

- **`@qcms/ui` (028) renderer capability:** the shared `<A2UIStepRenderer>` can render a **natively-submittable** step form - a real `<form>` the browser POSTs without JS, react-aria inputs serializing natively (each control emits a form-encoded field keyed by `questionId`), and a real submit control. Expose this as an opt-in prop/mode so the JS-controlled path is unchanged. Do **not** mutate the stored compiled document (ADR-18) - the submittability is a render-time capability, not a compiled-doc change. Add to `@qcms/ui`'s conformance/round-trip coverage. Changeset for `@qcms/ui`.
- **Portal (029) whole-step form-encoded BFF route:** a dedicated route handler (distinct from the per-question JSON `/answers` endpoint) that accepts the native form POST for a step, maps form fields -> canonical answers, posts them to the internal API (still R2: proxy/session/credential only - no validation authority), re-evaluates, and 303-redirects to the next step (or completion). The SSR `/s/:sessionId` page renders inside a native `<form method="post" action="...">` when JS is unavailable, hydrating into the existing controlled path when JS runs (progressive enhancement, no double-submit).
- Keep the strict-BFF discipline (R2) and the SSR-first, fetch-only portal shape (ADR-26). Server validation stays the authority; the no-JS path surfaces the API's typed errors by re-rendering the step with the error slots filled.
- Update `apps/portal/README.md`: remove/replace the "Known limitation: no-JS submission" note.

## Exit criteria

1. Playwright test with `javaScriptEnabled: false`: the minimal insurance fixture completes end-to-end (start -> answer -> branch -> submit) via native form POSTs with a page reload per step; the completion receipt (submittedAt, contentHash) renders.
2. Progressive enhancement: with JS **on**, the existing controlled per-answer path is unchanged (no double-submit, no regression) - the existing 029 Playwright suite stays green.
3. R2 preserved: the new whole-step BFF route imports nothing from `@qcms/core` except types (import-surface test); it performs no rule evaluation or validation authority.
4. `@qcms/ui` renderer's native-submit mode covered by the package's conformance suite; ADR-18 respected (stored compiled doc unchanged - submittability is render-time).

## Out of scope

Multi-step back-navigation UX beyond what the fixture needs (030/later); the visual design pass (030); any change to the compiled A2UI document shape or the API answer contract beyond adding the form-encoded route.
