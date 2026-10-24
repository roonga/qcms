/**
 * `@roonga/qcms-ui` public surface: the controlled A2UI step renderer, built on
 * `@a2ra/core`'s `A2Renderer` over vendored a2-react-aria components (ADR-22). It is
 * the only renderer, so admin preview fidelity is exact (ARCHITECTURE §6).
 */
export { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
export type { A2UIStepDocument, A2UIStepRendererProps } from "./A2UIStepRenderer.tsx";

export {
  NATIVE_FIELD_ANSWERED_PREFIX,
  NATIVE_FIELD_ANSWERED_VALUE,
  NATIVE_FIELD_KIND_PREFIX,
  SUBMIT_NODE_TYPE,
  withNativeSubmit,
} from "./native-submit.ts";
export type { NativeFieldKind, NativeFormAction, NativeSubmitOptions } from "./native-submit.ts";

export { withDemotedHeadings } from "./heading-demotion.ts";

export {
  QcmsFieldContext,
  useQcmsField,
  useQcmsFormAction,
  useQcmsLocale,
  useQcmsValues,
} from "./field-context.tsx";
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
 * The render-time `pattern` normalization, exported so an authoring surface can offer
 * its output as a suggestion rather than leaving every render to repair the same string.
 * Stored documents keep their original pattern whatever an author does next (R1, ADR-18).
 */
export { compilesUnderV, toVSafePattern } from "./v-safe-pattern.ts";

export { HoneypotSchema } from "./honeypot/honeypot.schema.ts";
export type { HoneypotNode } from "./honeypot/honeypot.schema.ts";

/**
 * The repeating group (ADR-42, ADR-43): the node types, the `__qop` wire vocabulary,
 * the render-time expansion and the behaviour context.
 *
 * The node vocabulary is also published on the React-free `./repeat-node` subpath,
 * because the portal's server-only BFF decoder reads `__qop` off a form POST and a
 * Server Component must not pull a client component in through a transitive import.
 */
export {
  QcmsRepeatContext,
  RepeatCell,
  RepeatCellSchema,
  RepeatGroup,
  RepeatGroupSchema,
  RepeatInstance,
  RepeatInstanceSchema,
  RepeatRow,
  RepeatRowSchema,
  RepeatTable,
  RepeatTableSchema,
  expandRepeatGroups,
  hasRepeatGroup,
  repeatTableNode,
  useQcmsRepeat,
} from "./repeat/index.ts";
export type {
  QcmsRepeatContextValue,
  RepeatCellNode,
  RepeatColumn,
  RepeatExpansion,
  RepeatGroupNode,
  RepeatInstanceNode,
  RepeatRowNode,
  RepeatTableInput,
  RepeatTableNode,
} from "./repeat/index.ts";
export {
  addButtonId,
  INSTANCE_NAME_SEPARATOR,
  INSTANCE_ORDINAL_PLACEHOLDER,
  REMOVE_LABEL_PLACEHOLDER,
  REPEAT_GROUP_NODE_TYPE,
  REPEAT_INSTANCE_NODE_TYPE,
  ROSTER_OPS,
  ROSTER_OP_FIELD,
  instanceLabelFor,
  parseRosterOpValue,
  qualifiedFieldName,
  removeLabelFor,
  rosterOpValue,
} from "./repeat/repeat-node.ts";
export type { RosterOp, RosterOpRequest } from "./repeat/repeat-node.ts";
/**
 * The table presentation's render-time vocabulary. `REPEAT_ROW_NODE_TYPE` is the one a
 * host needs by name: a table-presented group carries an instance's label on its row
 * rather than on an instance card, and the portal's error summary reads it there.
 */
export {
  REPEAT_CELL_NODE_TYPE,
  REPEAT_ROW_NODE_TYPE,
  REPEAT_TABLE_LEXICON,
  REPEAT_TABLE_NODE_TYPE,
  actionColumnLabel,
  cellLabelFor,
  instanceNoun,
  totalLabelFor,
} from "./repeat/index.ts";
