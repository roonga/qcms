# 118 - Portal per-form appearance

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/portal`, `@roonga/qcms-ui` if a token hook changes · **Depends on:** 109; the respondent-side appearance on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (P1, Q4, Q5, Q6) · ADR-07 · ADR-30 · SEC-9 · `docs/portal-constraints.md` · `plan/work-order-sequence.md`

## Context

Respondents see the form's appearance, frozen with the version they started. The deployment environment's theme stays the default when a version carries none. The appearance is applied on a page-level carrier so it covers the whole portal page, not only the step.

## Deliverables

- Per-form appearance from start-session and serve-step (109) applied on a page-level carrier in the portal layout: tokens, face, corners, density, the high-contrast palettes of that theme, the brand mark (logo through 109's route) per form.
- Deployment environment theme as default; respondent choices (display mode, high contrast) still apply over the form's appearance.
- CSP check: no inline style outside the existing nonce rules; the logo stays same-origin (`img-src 'self'`).
- Strings in `apps/portal/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none.

- A respondent mid-session keeps their version's appearance after a later publish.

## Required tests

- Playwright portal (X2): a form with its own appearance renders it; a form with none renders the environment default; appearance frozen across publish (start, publish a new appearance, continue: unchanged; new session: new); axe in light, dark and high contrast; no-JS render keeps the appearance; CSP nonce test still green.
- Vitest: carrier resolution order (respondent choice over form over environment).

## Files and areas

`apps/portal/app/layout.tsx`, `apps/portal/app/s/[sessionId]/page.tsx`, `apps/portal/components/{portal-shell,brand-mark,appearance-context}.tsx`, `apps/portal/lib/appearance.ts`, `apps/portal/lib/server/{api,csp}.ts`, `apps/portal/lib/i18n/en.ts`, `apps/portal/e2e/`.

## Migration

None.

## Gates

V, B, E (`plan/work-order-sequence.md`, Gates). E for the cross-service start-session and serve-step path.

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: a themed respondent page in light, dark and high contrast on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

The progress rail (119). The respondent menu and text size (120).
