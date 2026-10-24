import type { A2Node } from "@a2ra/core";

import { REPEAT_INSTANCE_NODE_TYPE } from "./repeat/repeat-node.ts";

/**
 * The document is stored, immutable content (R1, ADR-18) and cannot know what page it
 * will be shown inside, so the embedding page renumbers rather than dropping its own
 * `<h1>`. Only the `as` prop moves: `size` and `weight` stay as compiled, because an
 * admin preview promises what a respondent saw.
 */

/** Clamped at the last level, because the schema would reject an `h5`. */
const HEADING_LEVELS = ["h1", "h2", "h3", "h4"] as const;

type HeadingLevel = (typeof HEADING_LEVELS)[number];

function isHeadingLevel(value: unknown): value is HeadingLevel {
  return typeof value === "string" && (HEADING_LEVELS as readonly string[]).includes(value);
}

function demotedLevel(level: HeadingLevel, by: number): HeadingLevel {
  const index = Math.min(HEADING_LEVELS.indexOf(level) + by, HEADING_LEVELS.length - 1);
  return HEADING_LEVELS[index] ?? HEADING_LEVELS[HEADING_LEVELS.length - 1];
}

function mapNodeChildren(
  children: A2Node | A2Node[],
  map: (child: A2Node) => A2Node,
): A2Node | A2Node[] {
  return Array.isArray(children) ? children.map(map) : map(children);
}

function mapChildren(
  children: A2Node["children"],
  map: (child: A2Node) => A2Node,
): A2Node["children"] {
  const isNodes = children !== undefined && typeof children !== "string";
  return isNodes ? mapNodeChildren(children, map) : children;
}

/**
 * A render-time copy of `root` whose `Text` headings are `by` levels lower. `by <= 0`
 * allocates nothing, so a caller can pass a computed offset unbranched.
 */
export function withDemotedHeadings(root: A2Node, by: number): A2Node {
  if (by <= 0) return root;

  const demote = (node: A2Node): A2Node => {
    const children = mapChildren(node.children, demote);
    // An instance's label is a heading carried as a prop because it lives inside the
    // `<legend>` with the focus handle.
    const headingAs: unknown = node.props?.headingAs;
    if (node.type === REPEAT_INSTANCE_NODE_TYPE && isHeadingLevel(headingAs)) {
      return {
        ...node,
        props: { ...node.props, headingAs: demotedLevel(headingAs, by) },
        children,
      };
    }
    const as: unknown = node.props?.as;
    if (node.type !== "Text" || !isHeadingLevel(as)) return { ...node, children };
    return { ...node, props: { ...node.props, as: demotedLevel(as, by) }, children };
  };

  return demote(root);
}
