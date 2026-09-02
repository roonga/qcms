/**
 * @qcms/ui public surface (task 028): the controlled A2UI step renderer built
 * on `@a2ra/core`'s `A2Renderer` over vendored a2-react-aria components
 * (ADR-22). This is the *only* renderer - portal serving and admin preview both
 * go through it, so preview fidelity is exact (ARCHITECTURE §6).
 */
export { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
export type { A2UIStepDocument, A2UIStepRendererProps } from "./A2UIStepRenderer.tsx";

export { NATIVE_FIELD_KIND_PREFIX, SUBMIT_NODE_TYPE, withNativeSubmit } from "./native-submit.ts";
export type { NativeFieldKind, NativeSubmitOptions } from "./native-submit.ts";

export { withDemotedHeadings } from "./heading-demotion.ts";

export { QcmsFieldContext, useQcmsField } from "./field-context.tsx";
export type {
  A2UIAnswerValue,
  A2UIErrors,
  A2UIValues,
  QcmsField,
  QcmsFieldContextValue,
} from "./field-context.tsx";

export { registryForSpecVersion } from "./registry.tsx";

export { AuthorMessagesSchema, authorMessagesOf, withAuthorMessages } from "./author-messages.ts";
export type { AuthorMessages } from "./author-messages.ts";

export { documentForVisible } from "./visible.ts";

/**
 * The render-time `pattern` normalization (issue #29, PR #52), exported so an
 * authoring surface can offer its output as a suggestion rather than leaving
 * every render to repair the same string (issue #53). The renderer stays its
 * primary caller: stored documents are immutable and keep their original
 * pattern whatever an author does next (R1, ADR-18).
 */
export { compilesUnderV, toVSafePattern } from "./v-safe-pattern.ts";

export { HoneypotSchema } from "./honeypot/honeypot.schema.ts";
export type { HoneypotNode } from "./honeypot/honeypot.schema.ts";
