import type { A2Node } from "@a2ra/core";

import { REPEAT_INSTANCE_NODE_TYPE } from "./repeat/repeat-node.ts";

/**
 * Render-time heading demotion for an embedded compiled document.
 *
 * A compiled step carries its own outline, so a page that already has an `<h1>` and
 * embeds the document ends up with two: an outline defect for a screen-reader user
 * navigating by heading level. The document is stored, immutable content (R1, ADR-18)
 * and cannot know what page it will be shown inside, so the page is the only party that
 * can renumber, and the guest yields rather than the chrome.
 *
 * Only the `as` prop moves. `size`, `weight` and colour stay as compiled, because an
 * admin preview promises what a respondent saw. The stored bytes are never touched.
 */

/**
 * The heading levels the A2UI `Text` schema accepts, in order. Demotion clamps at the
 * end: `h4` stays `h4` rather than becoming an `h5` the schema would reject, so a deeply
 * nested embed degrades to a flat tail instead of a document the renderer refuses.
 */
const HEADING_LEVELS = ["h1", "h2", "h3", "h4"] as const;

type HeadingLevel = (typeof HEADING_LEVELS)[number];

function isHeadingLevel(value: unknown): value is HeadingLevel {
  return typeof value === "string" && (HEADING_LEVELS as readonly string[]).includes(value);
}

/** The level `level` becomes after `by` steps of demotion, clamped at the last level. */
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
 * Return a render-time copy of `root` whose `Text` headings are `by` levels lower.
 *
 * `by <= 0` returns the input unchanged and allocates nothing, so a caller can pass a
 * computed offset without branching. A `Text` node with no `as`, or with a non-heading
 * `as` (`p`, `span`, `label`), is left alone: only a heading has a level to demote.
 */
export function withDemotedHeadings(root: A2Node, by: number): A2Node {
  if (by <= 0) return root;

  const demote = (node: A2Node): A2Node => {
    const children = mapChildren(node.children, demote);
    // A repeat instance's label is a heading carried as a prop rather than a `Text` node,
    // because it lives inside the instance's `<legend>` with the focus handle. Same rule,
    // same clamp.
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
