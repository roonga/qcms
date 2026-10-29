/**
 * qcms-owned glue at the path the vendored `Button` imports: upstream declares no file for it and ADR-22
 * forbids editing the vendored source. Re-exports rather than copies, since a React context is identified by
 * object identity. Delete when upstream ships `action-context` as a file or registry dependency.
 */

export type { ActionCtx } from "@a2ra/core";
export { ActionContext } from "@a2ra/core";
