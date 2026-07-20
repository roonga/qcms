/**
 * @qcms/ui public surface (task 028): the controlled A2UI step renderer built
 * on `@a2ra/core`'s `A2Renderer` over vendored a2-react-aria components
 * (ADR-22). This is the *only* renderer - portal serving and admin preview both
 * go through it, so preview fidelity is exact (ARCHITECTURE §6).
 */
export { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
export type { A2UIStepDocument, A2UIStepRendererProps } from "./A2UIStepRenderer.tsx";

export { QcmsFieldContext, useQcmsField } from "./field-context.tsx";
export type {
  A2UIAnswerValue,
  A2UIErrors,
  A2UIValues,
  QcmsField,
  QcmsFieldContextValue,
} from "./field-context.tsx";

export { registryForSpecVersion } from "./registry.tsx";

export { HoneypotSchema } from "./honeypot/honeypot.schema.ts";
export type { HoneypotNode } from "./honeypot/honeypot.schema.ts";
