import type { A2Node } from "@a2ra/core";

import { instanceLabelFor, qualifiedFieldName, removeLabelFor } from "./repeat-node.ts";
import {
  actionColumnLabel,
  cellLabelFor,
  instanceNoun,
  NUMBER_CONTROL_NODE_TYPE,
  REPEAT_CELL_NODE_TYPE,
  REPEAT_ROW_NODE_TYPE,
  REPEAT_TABLE_NODE_TYPE,
} from "./repeat-table-node.ts";
import type { RepeatColumn } from "./repeat-table.schema.ts";
import { keepControl, qualifyNames, stringProp } from "./repeat-walk.ts";

/**
 * ADR-42 adds no question type: every cell is an ordinary question, so validation, retraction, rules and the
 * ledger and export grain work unchanged. A native `<table>` and never `role="grid"`, whose author-managed
 * focus is a tab trap without scripting; one tab stop per cell is the cost, bounded by the group's `max`
 * (SEC-16 sets no installation-wide ceiling).
 */

/** What the group's own expansion knows and this one needs. */
export interface RepeatTableInput {
  readonly groupId: string;
  /** Becomes the `<caption>`, and nothing else. */
  readonly label: string;
  /** `{n}` intact. */
  readonly instanceLabelTemplate: string;
  readonly removeLabelTemplate?: string;
  readonly removable: boolean;
  /** In roster order. */
  readonly instances: readonly string[];
  /** The member controls, once each, with the bare `questionId` as `name`. */
  readonly template: readonly A2Node[];
  /** Qualified names, when the host has a flow projection. */
  readonly visible?: ReadonlySet<string>;
  readonly opToken?: string;
}

// Rewritten rather than supplemented, so nothing enters the accessibility tree at one width and leaves it at
// another. A control with no `label` is not a question, so inventing a name would be worse.
function relabelCell(node: A2Node, rowLabel: string): A2Node {
  const label = stringProp(node, "label");
  if (label === undefined) return node;
  return { ...node, props: { ...node.props, label: cellLabelFor(rowLabel, label) } };
}

function columnsOf(input: RepeatTableInput): readonly RepeatColumn[] {
  return input.template.map((control) => {
    const questionId = stringProp(control, "name") ?? "";
    const numeric = control.type === NUMBER_CONTROL_NODE_TYPE;
    // The drawn cells, so a total never reports a cell the page does not show.
    const totalFields = input.instances
      .filter((instanceId) => keepControl(control, instanceId, input.visible))
      .map((instanceId) => qualifiedFieldName(instanceId, questionId));
    const description = stringProp(control, "description");
    return {
      questionId,
      label: stringProp(control, "label") ?? "",
      ...(description === undefined ? {} : { description }),
      ...(numeric ? { numeric: true, totalFields } : {}),
    };
  });
}

function rowNode(input: RepeatTableInput, instanceId: string, index: number): A2Node {
  const resolved = instanceLabelFor(input.instanceLabelTemplate, index + 1);
  const props: Record<string, unknown> = {
    groupId: input.groupId,
    instanceId,
    label: resolved,
    ordinal: index + 1,
  };
  if (input.removable && input.removeLabelTemplate !== undefined) {
    props.removeLabel = removeLabelFor(input.removeLabelTemplate, resolved);
  }
  if (input.removable && input.opToken !== undefined) props.opToken = input.opToken;
  const cells = input.template.map((control) => {
    const numeric = control.type === NUMBER_CONTROL_NODE_TYPE;
    const cellProps: Record<string, unknown> = {
      questionId: stringProp(control, "name") ?? "",
      ...(numeric ? { numeric: true } : {}),
    };
    const kept = keepControl(control, instanceId, input.visible);
    const cell: A2Node = { type: REPEAT_CELL_NODE_TYPE, props: cellProps };
    if (!kept) return cell;
    return { ...cell, children: [relabelCell(qualifyNames(control, instanceId), resolved)] };
  });
  return { type: REPEAT_ROW_NODE_TYPE, props, children: cells };
}

/**
 * The group's label becomes the `<caption>` and no heading node, unlike the stacked
 * presentation: a caption is the table's accessible name, so a heading above it would
 * say the collection's name twice for no navigational gain.
 */
export function repeatTableNode(input: RepeatTableInput): A2Node {
  const actionsLabel =
    input.removable && input.removeLabelTemplate !== undefined
      ? actionColumnLabel(input.removeLabelTemplate)
      : undefined;
  const props: Record<string, unknown> = {
    groupId: input.groupId,
    caption: input.label,
    rowHeader: instanceNoun(input.instanceLabelTemplate),
    columns: columnsOf(input),
    ...(actionsLabel === undefined || actionsLabel === "" ? {} : { actionsLabel }),
  };
  return {
    type: REPEAT_TABLE_NODE_TYPE,
    props,
    children: input.instances.map((instanceId, index) => rowNode(input, instanceId, index)),
  };
}
