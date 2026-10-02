import type { A2Node } from "@a2ra/core";

import { qualifiedFieldName } from "./repeat-node.ts";

/**
 * The node-walking helpers the repeat expansions share (tasks 073, 077).
 *
 * They were inside `repeat-expand.ts` while the stacked presentation was the only
 * one. The table presentation clones the same template into a different element
 * nesting and needs exactly the same four operations - read a prop, copy a child
 * list, qualify a control's `name`, decide whether a clone survives this instance's
 * visible set - so they live here, where one presentation's layout cannot drift from
 * another's idea of what a cloned control is.
 */

/**
 * Map a node's `children` union. A text body and an absent body are returned as they
 * are; a single child is mapped; an array is mapped elementwise.
 *
 * Split in two, exactly as `heading-demotion.ts` splits the same walk, so each
 * function has one declared result type: a single conditional chain over this union
 * is the shape the lint refuses, and for a good reason - it is the place a mapped
 * text body would silently become a node.
 */
function mapNodeChildren(
  children: A2Node | A2Node[],
  map: (child: A2Node) => A2Node,
): A2Node | A2Node[] {
  return Array.isArray(children) ? children.map(map) : map(children);
}

export function mapChildren(
  children: A2Node["children"],
  map: (child: A2Node) => A2Node,
): A2Node["children"] {
  const isNodes = children !== undefined && typeof children !== "string";
  return isNodes ? mapNodeChildren(children, map) : children;
}

export function childArray(children: A2Node["children"]): readonly A2Node[] {
  if (children === undefined || typeof children === "string") return [];
  return Array.isArray(children) ? children : [children];
}

export function stringProp(node: A2Node, key: string): string | undefined {
  const value: unknown = node.props?.[key];
  return typeof value === "string" ? value : undefined;
}

export function numberProp(node: A2Node, key: string): number | undefined {
  const value: unknown = node.props?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Rewrite one member control's `name` to its qualified form, recursively, so a
 * control whose own children carry no name (a `RadioGroup`'s `Radio` leaves, a
 * `CheckboxGroup`'s `Checkbox` leaves) is copied unchanged beneath it.
 *
 * Only the `name` prop moves. Every other compiled prop - `label`, `description`,
 * `isRequired`, the constraint hints, the author's `messages` - is the stored
 * content and is carried across untouched, which is what makes an instance's control
 * identical to the same question outside a group (ADR-42: a question does not know
 * that it is repeated).
 */
export function qualifyNames(node: A2Node, instanceId: string): A2Node {
  const mapped = mapChildren(node.children, (child) => qualifyNames(child, instanceId));
  const name = stringProp(node, "name");
  if (name === undefined) return { ...node, children: mapped };
  return {
    ...node,
    props: { ...node.props, name: qualifiedFieldName(instanceId, name) },
    children: mapped,
  };
}

/** Whether a cloned control survives this instance's visible set. */
export function keepControl(
  node: A2Node,
  instanceId: string,
  visible?: ReadonlySet<string>,
): boolean {
  if (visible === undefined) return true;
  const name = stringProp(node, "name");
  if (name === undefined) return true;
  return visible.has(qualifiedFieldName(instanceId, name));
}
