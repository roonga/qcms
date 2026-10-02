/**
 * The repeating-group half of the renderer (task 073, ADR-42, ADR-43): the two node
 * types, the `__qop` wire vocabulary, the render-time expansion, and the two
 * components the registry renders.
 */
export { RepeatGroup } from "./RepeatGroup.tsx";
export { RepeatInstance } from "./RepeatInstance.tsx";
export {
  QcmsRepeatContext,
  useQcmsRepeat,
  type QcmsRepeatContextValue,
} from "./repeat-context.tsx";
export { expandRepeatGroups, hasRepeatGroup, type RepeatExpansion } from "./repeat-expand.ts";
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
  type RosterOp,
  type RosterOpRequest,
} from "./repeat-node.ts";
export {
  RepeatGroupSchema,
  RepeatInstanceSchema,
  type RepeatGroupNode,
  type RepeatInstanceNode,
} from "./repeat.schema.ts";
