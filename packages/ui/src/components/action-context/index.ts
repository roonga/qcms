/**
 * Re-export the upstream context: object identity must agree with the vendored Button.
 * Remove this compatibility path when upstream provides its own module.
 */

export type { ActionCtx } from "@a2ra/core";
export { ActionContext } from "@a2ra/core";
