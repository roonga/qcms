/**
 * The `ActionContext` module the vendored `button` component imports as
 * `../../action-context`.
 *
 * It is qcms-owned glue, not vendored source, and it exists because the upstream
 * registry entry ships `Button.tsx` with its relative import but declares no file
 * or registry dependency for this module, so the vendored copy cannot resolve its
 * own import. ADR-22 forbids editing the vendored source, so the module is
 * provided at the path that source expects instead.
 *
 * It re-exports from `@a2ra/core` rather than copying: a React context is
 * identified by object identity, so a local copy would give `A2Renderer` and the
 * vendored `Button` two different contexts and the Button's action mode would
 * silently do nothing.
 *
 * Delete it when upstream ships `action-context` as a file or a registry
 * dependency, so `a2ra add button` compiles standalone.
 */

export type { ActionCtx } from "@a2ra/core";
export { ActionContext } from "@a2ra/core";
