# 011 - A2UI compiler

**Stage:** 4 · **Package:** `@qcms/a2ui-compiler` · **Depends on:** 008
**References:** `ARCHITECTURE.md` §3, §4 · ADR-01, ADR-14, **ADR-18** · the A2UI spec + `roonga/a2-react-aria`
**External input required:** the `roonga/a2-react-aria` repo - its component docs and styling guide are **required reading (ADR-22)**. Before starting, inventory the registry (`npx @a2ra/cli list`, the component docs pages, and `@a2ra/core`'s Zod schemas - the A2UI spec) and record the supported component/prop list in `docs/a2ui-mapping.md` - compile only to that subset. If a needed component doesn't exist there yet (candidates known today: multiline text for `longText`, a checkbox group for `multiChoice`), that is a **blocking cross-repo issue** (file it in both repos; upstream contribution first per ADR-22), not something to invent around.

## Context

The pure projection from meaning to view: `FormDefinition → A2UI documents`, one per step, produced at publish time and stored in the snapshot. This package is the reserved agent seam. Per ADR-18, output is stamped with compiler and spec versions because the stored copy is served forever.

## Deliverables

- `compileForm(snapshot: FrozenSnapshot, options: { locale?: LocaleCode }): CompiledForm` - `{ documents: A2UIDocument[] (one per step, keyed by stepId), compilerVersion, a2uiSpecVersion }`. Deterministic, side-effect free; depends on `@qcms/core` types only (never `db`, never React).
- Question-type → A2UI component mapping using the **registry's real component names** (the inventory is authoritative; where the spec offers choices, document the choice):
  - `shortText` → `text-field` · `longText` → multiline text (confirm upstream component/prop in inventory) · `number` → `number-field` · `date` → `date-picker` · `boolean` → `checkbox` or yes/no `radio` (pick one, document) · `singleChoice` → `radio` group (`select` above a documented option-count threshold) · `multiChoice` → checkbox group (confirm upstream component in inventory).
- Constraint surfacing as client-side hints (min/max/length/pattern/required) - explicitly marked advisory; server validation is authority.
- Locale resolution via `resolveText` with the form's `defaultLocale` (single-locale launch; `options.locale` is the future seam).
- Accessibility groundwork in output: every control carries label/description references; step documents carry a heading structure the renderer maps to `h1/h2`; error-slot placeholders per question (the renderer fills them - 028 relies on this).
- `compilerVersion` from package.json; `a2uiSpecVersion` a package constant recording the schema version of the pinned `@a2ra/core` (ADR-22 - the A2UI spec *is* those Zod schemas).
- Output validation: compiled documents validate against `@a2ra/core`'s exported Zod schemas **in tests** (`@a2ra/core` as devDependency only - the package's runtime stays React-free and never imports it).
- **Seam interface**: `StepResolver` - the interface an adaptive/agent resolver would implement, with the static compiler as its default implementation and a stub test double. Documented in `docs/agent-seam.md`.

## Exit criteria

1. Kitchen-sink fixture compiles; every question type appears; output reviewed by hand once and committed (seeds 012's corpus).
2. Determinism test: two runs → deep-equal output.
3. No forbidden imports (`db`, React, Node-only APIs) - enforced by lint/import test.
4. Mapping table documented (`docs/a2ui-mapping.md`): type → component → props → hints.
5. Every compiled fixture document validates against the pinned `@a2ra/core` schemas (spec conformance is mechanical, not asserted by eye).

## Out of scope

Rendering (028), corpus policy/CI (012), serving (019), adaptive resolvers (Phase 4).
