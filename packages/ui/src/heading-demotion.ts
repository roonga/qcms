import type { A2Node } from "@a2ra/core";

/**
 * Render-time heading demotion for an EMBEDDED compiled document (issue #537).
 *
 * ## The defect this closes
 *
 * A compiled step document carries its own outline: the form title as an `h1` on the
 * first step, the step title as an `h2` on every step
 * (`@qcms/a2ui-compiler`'s `step-resolver.ts`). On the portal that is exactly right -
 * the document IS the page, so its `h1` is the page's `h1`.
 *
 * The admin embeds the same document inside a page that already has one. `/forms/{id}/versions/{v}`
 * ended up with two `<h1>`s: the route's own, naming the version, and the stored
 * document's, naming the form. Two top-level headings on one page is a document-outline
 * defect - a screen-reader user navigating by heading level gets two competing answers to
 * "what is this page" - and it makes `getByRole("heading", { level: 1 })` ambiguous on the
 * route, which is how it was found (a Playwright strict-mode violation while proving
 * issue #510, not by inspection).
 *
 * ## Why the fix is here rather than in the admin chrome
 *
 * The other side of the choice is for the route to drop its own `h1` when the document
 * supplies one, and that is worse for two reasons. The route's heading names the page's
 * actual subject (`Version 3`, issue #510); the document's names the form, which is
 * already in the breadcrumb. And the compiled document is *stored, immutable content*
 * (R1, ADR-18) served for the life of the snapshot: it cannot know what page it will be
 * shown inside, so the page is the only party that can know. The chrome yields nothing and
 * the guest is renumbered, which is the ordinary rule for embedding a document in a page.
 *
 * ## What it does and does not change
 *
 * Only the `as` prop moves. `size`, `weight`, colour and everything else are left exactly
 * as compiled, because an admin preview's whole promise is "this is what a respondent
 * saw"; restyling the headings to match their new level would trade that away to fix an
 * outline problem. So the demoted heading still LOOKS like the heading it is in the
 * portal, and now sits correctly under the page's own `h1` in the outline.
 *
 * ADR-18 is respected the same way {@link withNativeSubmit} respects it: this returns a
 * shallow-cloned copy for the render, and never touches the stored bytes.
 */

/**
 * The heading levels the A2UI `Text` schema accepts, in order. Demotion walks right along
 * this list and stops at the end: `h4` stays `h4` rather than becoming an `h5` the schema
 * would reject, so a deeply-nested embed degrades to a flat tail instead of producing a
 * document the renderer refuses.
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

/**
 * Map an `A2Node`'s `children` union.
 *
 * `children` is `A2Node | A2Node[] | string | undefined`, and each arm answers
 * differently: a text body and an absent body are returned as they are, a single child
 * is mapped, an array is mapped elementwise. Expressed as one conditional chain rather
 * than three returns so the function has a single exit and one declared result type.
 */
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
    const as: unknown = node.props?.as;
    // A `Text` with no `as`, or with a non-heading one (`p`, `span`, `label`), has no
    // level to move: copied for the render, otherwise untouched.
    if (node.type !== "Text" || !isHeadingLevel(as)) return { ...node, children };
    return { ...node, props: { ...node.props, as: demotedLevel(as, by) }, children };
  };

  return demote(root);
}
