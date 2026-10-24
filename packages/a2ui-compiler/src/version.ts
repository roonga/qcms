/**
 * Version stamps written into every compiled form (ADR-18): the stored document
 * is served forever, so it records which compiler produced it and which A2UI
 * spec it targets.
 *
 * Both are constants rather than runtime reads, so the runtime bundle stays
 * React-free and never imports the vendored schemas. A drift test asserts each
 * still matches its source of truth, so bumping a package without updating its
 * stamp fails the gate.
 */

/**
 * This package's version, mirroring `package.json`.
 *
 * A mapping change that alters existing output moves this stamp and opens a new
 * golden generation; earlier generations are retained as the record of what each
 * stamp produced (ADR-18, append-only). A published snapshot is served from its
 * stored bytes and never recompiled, so a stamp change reshapes what the
 * compiler emits next and nothing that exists.
 *
 * {@link A2UI_SPEC_VERSION} does not move with it: a qcms-owned node type moves
 * no vendored schema, so the pinned dependency stays where it is (ADR-43).
 */
export const COMPILER_VERSION = "0.3.0";

/**
 * The pinned `@a2ra/core` package version whose schemas the compiled output
 * validates against. The package version, not that package's own exported
 * `VERSION` constant, which is stale (`docs/a2ui-mapping.md`).
 */
export const A2UI_SPEC_VERSION = "1.0.0-preview.7";
