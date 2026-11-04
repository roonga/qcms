import type { A2Node } from "@a2ra/core";

import { qualifiedFieldName } from "./repeat-node.ts";

// Share child traversal between presentations so their node/text treatment cannot drift.
// Separate return types prevent mapped text from silently becoming a node.
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
 * Only the `name` prop moves: every other compiled prop is stored content carried
 * across untouched, which is what makes an instance's control identical to the same
 * question outside a group (ADR-42: a question does not know it is repeated).
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
