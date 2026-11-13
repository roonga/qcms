# 108 - Appearance schema and the workspace themes table

**Stage:** 9 (Phase 4) · **Apps/packages:** `@roonga/qcms-db`, `apps/api` (publish copy), `create-qcms-app` templates · **Depends on:** 107; 086 merged
**References:** `plan/agent-builder-decisions.md` (D1, D2, Q4, Q10, review findings) · `docs/WORKSPACE_ACCESS.md` sections 9 and 11 · ADR-07 · ADR-30 · `plan/work-order-sequence.md` (Migration queue)

## Context

The builder's single migration. D1 and D2 ship as one migration so the queue holds one builder slot: **085, 086, 108, 088, 090, 092**. Nothing writes the new columns until 109; until then the column exists and no route writes it.

## Deliverables

- D1: nullable `appearance` jsonb on `control.form_drafts` and `control.form_versions`, typed by 107's schema. Publish copies the draft's appearance into the version in the same transaction; a version's appearance is frozen with it (append-only, ADR-07). Appearance holds tokens by value and no theme reference (spec section 9).
- D2: `control.workspace_themes` (workspace, name, colour tokens, face, corners, logo, source host of a derive, created and updated by and at) and the workspace appearance lock column on the workspace (`control.organization`).
- Logo storage, decided here: immutable and content-addressed (for example an append-only table keyed by a hash of the bytes), holding raster logos only (PNG, JPEG, WebP), size-capped by a CHECK on the byte length. A theme, a draft and a version reference a logo by that key, so changing or deleting a theme never changes or removes the logo a draft or version carries.
- `control.access_audit`: extend `ACCESS_AUDIT_KINDS` and its CHECK with one kind for a theme derive fetch (spec section 11, one row per fetch; the kind's name is settled here). The lock uses the existing `setting` kind.
- Confirm that `control.agent_actions` holds a draft edit row and an Undo row (111) in its current columns, one token id per edit; any column 111 needs goes in this migration, because there is no second builder migration.
- Grants for the new table per the grant emitters; `meta/` snapshot; template mirrors.

## Exit criteria

Spec criteria owned: none.

- One migration, numbered at rebase time in the queue order (planned `0010`).
- A publish copies appearance, and a version's appearance cannot change afterwards.
- A stored logo cannot be changed, and deleting a theme leaves every logo a draft or version references.

## Required tests

- Append-only: an `UPDATE` of `form_versions.appearance` is refused for the application roles (`packages/db/src/schema/append-only.test.ts`).
- Publish copies appearance, including null; a later draft change leaves the version unchanged.
- Append-only: an `UPDATE` or `DELETE` of a stored logo is refused for the application roles; deleting a theme leaves a logo a version references.
- Logo storage refuses a logo over the cap and an unknown content type; the audit CHECK accepts the derive kind and still refuses an unknown one.
- Migration chain and restore-regrant tests stay green with the new table (`apps/api/e2e/security/04-db-restore-regrant.e2e.ts` under E).

## Files and areas

`packages/db/src/schema/control/{forms,auth,access-audit}.ts`, `packages/db/src/schema/control/workspace-themes.ts` (new, with the logo storage), `packages/db/src/schema/control/index.ts`, `packages/db/migrations/` and `meta/`, `packages/db/src/schema/{append-only,constraints}.test.ts`, `apps/api/src/features/releases/` and `apps/api/src/features/forms/handler.ts` (publish copy), `packages/create-qcms-app/templates/`.

## Migration

Yes. Third in the migration queue, after 086 and before 088 (planned `0010`; numbered at rebase time).

## Gates

V, D, E (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

None.

## Out of scope

Any route reading or writing appearance, themes or the lock (109). The derive fetcher (110).
