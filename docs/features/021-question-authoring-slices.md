# 021 - Question authoring slices

**Stage:** 6 · **App:** `apps/api` (`features/questions/*`, `/admin` group) · **Depends on:** 017, 014
**References:** `DOMAIN_SCHEMA.md` §4.2 · ADR-02 · I8/R6 · R5 · cut-line R7

## Context

The question library, headless - consumed by tests now, the admin app in 032. Honest transaction scripts (R5): CRUD with the kernel's schemas as validators. The version lifecycle (draft → published → referenced/deprecated) is enforced here and in storage.

## Deliverables

Admin-group routes (auth middleware: better-auth session - a permissive test stub until 031 wires real auth; the middleware seam is real from day one):

- `POST /admin/questions` - create with first draft version; body validated by `QuestionDefinition` (003). **R6 enforcement:** reject any `questionId` ever used before, including deleted/deprecated (`isQuestionIdTaken`), with `QUESTION_ID_REUSED`.
- `POST /admin/questions/:id/versions` - new draft version seeded from latest.
- `PUT /admin/questions/:id/versions/:v` - edit a **draft** version only; editing published/deprecated → `VERSION_IMMUTABLE`.
- `POST /admin/questions/:id/versions/:v/publish` - draft → published (makes it pinnable; I2's `UNPUBLISHED_QUESTION_PIN` depends on this state).
- `POST /admin/questions/:id/versions/:v/deprecate` - published/referenced → deprecated. Blocks **new** pins only (enforced in 022's draft validation); existing pins and history untouched.
- `GET /admin/questions` (list with latest-version summary, status filters, search by slug/label) · `GET /admin/questions/:id` (all versions).
- No delete endpoint exists - questions are deprecated, never deleted (R6). Document in the slice README.
- Annotate every route with its intended `/api/v1` scope in route metadata (SEC-5: `questions:read` for reads, `questions:write` for authoring) - inert at launch; exists so Phase-4 activation is wiring, not archaeology.

## Exit criteria

1. Lifecycle walk: create → edit draft → publish → edit rejected → new version → deprecate; each transition and each invalid transition tested.
2. R6: recreate-after-deprecate with same id rejected; new id fine.
3. Malformed definitions rejected with kernel error paths intact (422 passes Zod issues through the envelope).
4. Auth seam: requests without the (stub) auth context → 401; group absent entirely in public-only mount (017's flags).

## Out of scope

Form/draft endpoints (022), admin UI (032), impact analysis and pin-cascade UX (Phase 4 - R7).
