# 109 - Draft appearance, workspace themes, the lock and the logo route

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/portal` (logo route), `create-qcms-app` templates · **Depends on:** 108, 085
**References:** `plan/agent-builder-decisions.md` (A2, A3, Q4, Q10, Q18, "Security review requirements": Lock, Logo route) · `docs/WORKSPACE_ACCESS.md` sections 3, 9, 11 and 14 (criteria 118, 120, 121, 122, 124) · SEC-3, SEC-9, SEC-15 · `plan/work-order-sequence.md`

## Context

The routes that read and write appearance, themes and the lock. The lock is the API's refusal, never the assistant's: it sits in the draft PUT, which every author and the builder use. Appearance goes inside the draft PUT body, not a second write route, so there is one revision counter and one agent-assisted mark.

## Deliverables

- A2:
  - The draft PUT accepts `appearance`, validates it with 107's schema and contrast check, and refuses any change to appearance while the workspace lock is set, for every actor. A save that leaves appearance unchanged succeeds under the lock.
  - Applying a theme is a draft PUT carrying the theme's appearance by value, its logo by 108's storage key; nothing on the draft refers to the theme, so a theme change or delete alters no draft and no version.
  - Draft GET, start-session and serve-step return the appearance of the draft or the pinned version; a respondent keeps the version they started (ADR-07).
  - OpenAPI regenerated.
- A3:
  - Workspace themes list, read, create, change and delete: Edit forms in that workspace (spec section 3).
  - Set and clear the appearance lock: Workspace administrator of that workspace or Site administrator (Code Owner, 2026-11-13); no second approval, even with the rule on; one `setting` row in the workspace audit.
  - Logo upload on a theme: PNG, JPEG or WebP confirmed by magic-number sniff, size-capped, SVG refused.
  - The logo route: served without a session, fixed content type, `X-Content-Type-Options: nosniff`, from the portal's own origin so SEC-9's `img-src` holds. It serves only a raster logo held in 108's immutable logo storage, for a theme, a draft or a version, and takes no grant.
- SEC-3 §3.2 route rows for every new route; `route-policy.ts` rows; agent kinds on these routes stay absent until 117.

## Exit criteria

Spec criteria owned: **118, 120, 121, 122, 124**. This task owns those and no others.

- Every new or changed route is in `matrix-coverage.e2e.ts` and `01-authorization-matrix.e2e.ts`.

## Required tests

- Authorisation (X3, A2): a draft PUT changing appearance on a locked workspace is refused for an Edit forms holder, a Workspace administrator, a Site administrator and through the assistant's draft path; a PUT changing no appearance succeeds.
- Theme save refused for a View forms holder, for an Edit forms holder of another workspace and for an administrator without Edit forms (criterion 118).
- Lock set and clear refused for an Edit forms holder; accepted with second approval on and no approver; exactly one `setting` row (criterion 120).
- Logo route: no session needed; fixed content type and `nosniff` headers; an SVG, a polyglot and an over-cap upload refused; an unknown logo key is a uniform 404 (criterion 122).
- By value (criterion 124): apply a theme, publish, then change and delete the theme: the draft, a locked draft included, and the version keep their appearance, and the logo route still serves the version's logo.
- Contrast: a PUT with failing contrast is refused with the correction report.
- Matrix rows (M) for every route above.

## Files and areas

`apps/api/src/features/forms/{handler,schema,route}.ts` (draft PUT and GET), `apps/api/src/features/workspaces/` (themes and lock), `apps/api/src/features/responses/{start-session,serve-step}/`, `apps/api/src/features/membership/route-policy.ts`, `apps/portal/app/` (logo route), `apps/portal/lib/server/csp.ts` (check only), `apps/api/e2e/security/`, `docs/SECURITY_DESIGN.md` (§3.2 rows), `docs/openapi/admin.json`, `packages/create-qcms-app/templates/`.

## Migration

None (108 holds the columns).

## Gates

V, D, E, M (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round (authorisation, unauthenticated logo route); Sonnet delta.

## Design gate

None. No UI.

## Out of scope

Theme derive (110). The drawer and the settings UI (116). Portal rendering of appearance (118). Action kinds for themes (117).
