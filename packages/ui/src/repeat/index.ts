/**
 * The repeating-group half of the renderer (tasks 073 and 077, ADR-42, ADR-43): the
 * node types, the `__qop` wire vocabulary, the render-time expansion, and the
 * components the registry renders.
 *
 * Two presentations live here. **Stacked** (073) is one `RepeatInstance` card per live
 * instance. **Table** (077) is a native `<table>` - `RepeatTable`, `RepeatRow`,
 * `RepeatCell` - and never `role="grid"`.
 */
export { RepeatCell } from "./RepeatCell.tsx";
export { RepeatGroup } from "./RepeatGroup.tsx";
export { RepeatInstance } from "./RepeatInstance.tsx";
export { RepeatRow } from "./RepeatRow.tsx";
export { RepeatTable } from "./RepeatTable.tsx";
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
export {
  REPEAT_CELL_NODE_TYPE,
  REPEAT_ROW_NODE_TYPE,
  REPEAT_TABLE_NODE_TYPE,
  REPEAT_TABLE_LEXICON,
  actionColumnLabel,
  cellLabelFor,
  instanceNoun,
  totalLabelFor,
} from "./repeat-table-node.ts";
export {
  RepeatCellSchema,
  RepeatRowSchema,
  RepeatTableSchema,
  type RepeatCellNode,
  type RepeatColumn,
  type RepeatRowNode,
  type RepeatTableNode,
} from "./repeat-table.schema.ts";
export { repeatTableNode, type RepeatTableInput } from "./repeat-table-expand.ts";
