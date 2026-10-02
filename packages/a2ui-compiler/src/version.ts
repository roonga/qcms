/**
 * Version stamps written into every {@link CompiledForm} (ADR-18): the stored
 * compiled A2UI is served forever, so each document records which compiler
 * produced it and which A2UI spec (the pinned `@a2ra/core` Zod schemas, ADR-22)
 * it targets.
 *
 * Both are constants here rather than runtime reads: the runtime bundle stays
 * React-free and never imports `@a2ra/core` (the schemas are a test-only
 * devDependency). A drift test (`version.test.ts`) asserts each constant still
 * matches its source of truth - `COMPILER_VERSION` against this package's
 * `package.json`, `A2UI_SPEC_VERSION` against the installed `@a2ra/core`
 * version - so bumping either package without updating the stamp fails the gate.
 */

/**
 * This package's version (mirrors `package.json`; guarded by `version.test.ts`).
 *
 * Bumped 0.0.0 → 0.1.0 in task 026: the compiler emits a honeypot decoy in every
 * step document (a mapping change that alters existing output), so the stamp
 * changed and the frozen goldens moved to a new generation directory
 * (`golden/v2/`, `golden/README.md` spec-bump procedure). `golden/v1/` stays a
 * faithful record of what `0.0.0` produced (ADR-18, append-only).
 *
 * Bumped 0.1.0 → 0.2.0 for issue #186, by the same rule and for the same reason:
 * every compiled heading now carries `size` and `weight`, so every corpus form's
 * output changes and `golden/v3/` is the new current generation. `golden/v2/`
 * joins `v1/` as retained. A snapshot published under `0.1.0` is served from its
 * stored bytes and never recompiled, so a stamp change reshapes what the compiler
 * emits NEXT and nothing that already exists.
 *
 * Bumped 0.2.0 → 0.3.0 in task 073 (ADR-42, ADR-43): a repeating group now compiles
 * to a `RepeatGroup` **template** node the renderer clones per live instance, which
 * is a node type the mapping did not carry, so `golden/v4/` is the new current
 * generation and `golden/v3/` joins `v1/` and `v2/` as retained.
 *
 * **`A2UI_SPEC_VERSION` does NOT move with it, and that is the honeypot's
 * precedent rather than an omission.** ADR-18's amendment of 2026-09-30 reads
 * "`A2UI_SPEC_VERSION` and `COMPILER_VERSION` both move", and the constant below
 * cannot: it is the installed `@a2ra/core` **package** version, asserted against
 * `node_modules/@a2ra/core/package.json` by `version.test.ts`, and `RepeatGroup` is
 * deliberately a **qcms-owned** node type rather than an `@a2ra/core` registry
 * component (ADR-43, the `HONEYPOT_NODE_TYPE` precedent), so no vendored schema
 * moved and the pinned dependency did not either. Task 026 added the `Honeypot`
 * node type on exactly these terms and moved this constant alone. Moving the spec
 * stamp would mean bumping the vendored dependency, which is not what a new qcms
 * node type is; the generation the amendment asks for is opened by this stamp.
 * Reported to the Code Owner with task 073.
 */
export const COMPILER_VERSION = "0.3.0";

/**
 * The pinned `@a2ra/core` package version whose Zod schemas the compiled output
 * validates against. Note this is the *package* version, not `@a2ra/core`'s
 * exported `VERSION` constant, which is stale (`0.1.0-preview.0`) - see
 * `docs/a2ui-mapping.md`.
 */
export const A2UI_SPEC_VERSION = "1.0.0-preview.7";
