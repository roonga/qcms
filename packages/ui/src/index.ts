/** The controlled A2UI step renderer, over vendored a2-react-aria components (ADR-22). */
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

/** Public so an authoring surface can offer the rewrite rather than repair it per render. */
export { compilesUnderV, toVSafePattern } from "./v-safe-pattern.ts";

export { HoneypotSchema } from "./honeypot/honeypot.schema.ts";
export type { HoneypotNode } from "./honeypot/honeypot.schema.ts";

/**
 * The node vocabulary is also published on the React-free `./repeat-node` subpath,
 * because a Server Component decoding `__qop` must not pull a client component in
 * through a transitive import.
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
 * `REPEAT_ROW_NODE_TYPE` is public because a table-presented group carries an
 * instance's label on its row rather than on an instance card.
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
