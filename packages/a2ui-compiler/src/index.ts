/**
 * `@qcms/a2ui-compiler` public surface (task 011): the pure projection from a
 * published `FrozenSnapshot` to A2UI documents (one per step), plus the
 * step-resolver seam (ARCHITECTURE §12). Runtime is React-free and depends on
 * `@qcms/core` types only - never `db`, never React, never a runtime
 * `@a2ra/core` import (the spec schemas are a test-only devDependency).
 */
export { compileForm, compileFormWith } from "./compile.js";

export { HONEYPOT_FIELD_NAME, HONEYPOT_NODE_TYPE, honeypotNode } from "./honeypot.js";

export {
  BOOLEAN_AFFIRMATION,
  BOOLEAN_FALSE_VALUE,
  BOOLEAN_TRUE_VALUE,
  SINGLE_CHOICE_SELECT_THRESHOLD,
  questionToNode,
  type TextResolver,
} from "./mapping.js";

export {
  staticStepResolver,
  type StepResolver,
  type StepResolverContext,
} from "./step-resolver.js";

export type { A2UIDocument, A2UINode, CompiledForm } from "./types.js";

export { A2UI_SPEC_VERSION, COMPILER_VERSION } from "./version.js";
