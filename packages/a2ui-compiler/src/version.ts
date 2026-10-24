/**
 * Version stamps written into every compiled form (ADR-18). Constants rather
 * than runtime reads, so the bundle stays React-free and never imports the
 * vendored schemas; a drift test holds each to its source of truth.
 */

/**
 * This package's version, mirroring `package.json`. Moving it opens a new golden
 * generation and reshapes only what the compiler emits next (ADR-18).
 * {@link A2UI_SPEC_VERSION} does not move with it (ADR-43).
 */
export const COMPILER_VERSION = "0.3.0";

/**
 * The pinned `@a2ra/core` package version the output validates against. The
 * package version, not that package's own `VERSION` constant, which is stale.
 */
export const A2UI_SPEC_VERSION = "1.0.0-preview.7";
