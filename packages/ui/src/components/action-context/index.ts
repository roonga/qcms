/**
 * qcms-owned glue at the path the vendored `Button` imports: the upstream registry
 * entry declares no file for this module, and ADR-22 forbids editing the vendored
 * source. It re-exports rather than copies, because a React context is identified by
 * object identity and a local copy would silently disable the Button's action mode.
 *
 * Delete it when upstream ships `action-context` as a file or registry dependency.
 */

export type { ActionCtx } from "@a2ra/core";
export { ActionContext } from "@a2ra/core";
