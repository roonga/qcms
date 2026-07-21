import type { A2UIStepDocument } from "@qcms/ui";

/**
 * Apply the API's flow projection to the compiled step document (task 029).
 *
 * The API serves the FULL compiled step document plus an authoritative
 * `flowState.visibleQuestions` list (the forward-pass result). The shared
 * renderer draws whatever tree it is given, so the portal is the integration
 * point that renders only the visible questions: a conditional follow-up appears
 * when the API says it is visible and disappears when it is not (wireframe:
 * branch-inserted / branch-removed). This is presentation over the API's
 * authoritative projection, never a re-evaluation of rules (R2).
 *
 * A node is a question control iff it carries a string `name` prop (the
 * questionId, per the a2ui mapping); such a node is dropped unless its name is in
 * the visible set. Layout and text nodes (no `name`) are always kept, with their
 * children pruned recursively.
 */

interface MutableNode {
  type: string;
  props?: Record<string, unknown>;
  children?: MutableNode | MutableNode[] | string;
}

function questionName(node: MutableNode): string | undefined {
  const name = node.props?.name;
  return typeof name === "string" ? name : undefined;
}

function pruneNode(node: MutableNode, visible: ReadonlySet<string>): MutableNode | null {
  const name = questionName(node);
  if (name !== undefined && !visible.has(name)) return null;

  const { children } = node;
  if (typeof children === "string" || children === undefined) {
    return { ...node };
  }
  if (Array.isArray(children)) {
    const kept: MutableNode[] = [];
    for (const child of children) {
      const pruned = pruneNode(child, visible);
      if (pruned !== null) kept.push(pruned);
    }
    return { ...node, children: kept };
  }
  const prunedChild = pruneNode(children, visible);
  if (prunedChild === null) {
    const copy = { ...node };
    delete copy.children;
    return copy;
  }
  return { ...node, children: prunedChild };
}

/**
 * Return a copy of `document` whose tree contains only the questions in
 * `visibleQuestions` (plus all non-question layout/text nodes). The root is never
 * a question node, so it is always retained.
 */
export function documentForVisible(
  document: A2UIStepDocument,
  visibleQuestions: readonly string[],
): A2UIStepDocument {
  const visible = new Set(visibleQuestions);
  const root = pruneNode(document.root, visible) ?? {
    type: "Form",
    children: [],
  };
  return { stepId: document.stepId, root: root };
}
