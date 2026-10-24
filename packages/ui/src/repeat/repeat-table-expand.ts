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
 * The table presentation's render-time expansion (ADR-43).
 *
 * `presentation: "table"` lays instances out as rows and member questions as columns.
 * ADR-42 adds no question type: every cell is an ordinary question with an ordinary
 * `AnswerValue`, so validation, retraction, the rules DSL, the ledger grain, the
 * export grain and the reporting view all work unchanged, and this is a layout rather
 * than an input control.
 *
 * It is a native `<table>` and never `role="grid"`, because APG gives as a defining
 * property of the grid pattern that it requires author code to manage focus movement
 * inside it, so with scripting off a grid is a tab trap and this surface's no-JS
 * claim would be qualified. The documented cost is one tab stop per cell, which is
 * the expected behaviour of the ruled choice rather than a defect to mitigate with
 * script; the group's own `max` is what bounds it (SEC-16 sets no
 * installation-wide ceiling, so the count is the author's decision).
 *
 * The cell count is structural, which is why a cell is a node: a per-instance rule
 * can hide a member question in one instance and not another, and a short row shears
 * every later column off its header, so a hidden member leaves its `RepeatCell`
 * behind with no child.
 */

/** What the group's own expansion knows and this one needs. */
export interface RepeatTableInput {
  readonly groupId: string;
  /** The group's authored label: the `<caption>`, and nothing else. */
  readonly label: string;
  /** The instance-label template, `{n}` intact. */
  readonly instanceLabelTemplate: string;
  /** The compiled "Remove {label}" template, when the group offers a removal. */
  readonly removeLabelTemplate?: string;
  /** Whether this group's instances may be removed at all (`countSource: "open"`). */
  readonly removable: boolean;
  /** The live roster, in roster order. */
  readonly instances: readonly string[];
  /** The group's member controls, once each, with the bare `questionId` as `name`. */
  readonly template: readonly A2Node[];
  /** The visible qualified field names, when the host has a flow projection. */
  readonly visible?: ReadonlySet<string>;
  /** The one-time operation token this render mints into its `__qop` values. */
  readonly opToken?: string;
}

/**
 * Relabel one cloned control to its cell's own name.
 *
 * A real `<label>` per cell is the only encoding that survives both layouts, so the
 * label is rewritten rather than supplemented: above the reflow the CSS clips it and
 * the visible headers are what a sighted respondent reads, and below the reflow the
 * same element is shown outright because the headers are gone. Nothing enters the
 * accessibility tree at one width and leaves it at another.
 *
 * A control with no `label` prop is left alone rather than given one: the compiler
 * labels every question, so this is a template that is not a question and inventing a
 * name for it would be worse than leaving it.
 */
function relabelCell(node: A2Node, rowLabel: string): A2Node {
  const label = stringProp(node, "label");
  if (label === undefined) return node;
  return { ...node, props: { ...node.props, label: cellLabelFor(rowLabel, label) } };
}

/** The columns, in template order, read off the group's own member controls. */
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

/** One row: its props, and one `RepeatCell` per column whatever a rule hid. */
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
 * The single `RepeatTable` node a table-presented group expands to, whose children are
 * one `RepeatRow` per live instance in roster order.
 *
 * The group's own label becomes the `<caption>` and is not also emitted as a heading
 * node the way the stacked presentation emits one: a caption is the table's accessible
 * name and is announced on entering it, so a heading above it would say the
 * collection's name twice for no navigational gain.
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
