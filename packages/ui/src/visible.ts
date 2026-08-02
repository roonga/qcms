import type { A2UIStepDocument } from "./A2UIStepRenderer.tsx";

/**
 * Project a compiled step document onto an authoritative visible set.
 *
 * The API serves the FULL compiled step document (ADR-18: the stored audit copy,
 * never a recompilation) plus a `visibleQuestions` list, which is the forward
 * pass's result (ADR-16). The renderer draws whatever tree it is handed, so
 * something has to drop the questions the flow says are not visible. This is that
 * something, and it is presentation over an authoritative projection - never a
 * re-evaluation of rules, which neither frontend is allowed to perform (R2).
 *
 * It lives in `@qcms/ui` rather than in either app because **both** consumers
 * need the identical projection: the portal serving a respondent (task 029) and
 * the admin previewing a draft (task 034). Preview fidelity is the reason
 * `@qcms/ui` exists at all (ARCHITECTURE §6), and a second copy of this function
 * is exactly how "what the author saw" and "what the respondent got" would
 * quietly diverge - the same argument that keeps `A2UIStepRenderer` singular.
 *
 * A node is a question control iff it carries a string `name` prop (the
 * questionId, per the a2ui mapping); such a node is dropped unless its name is in
 * the visible set. Layout and text nodes (no `name`) are always kept, with their
 * children pruned recursively. The root is never a question node, so it survives.
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
 * `visibleQuestions` (plus all non-question layout/text nodes).
 */
export function documentForVisible(
  document: A2UIStepDocument,
  visibleQuestions: readonly string[],
): A2UIStepDocument {
  const visible = new Set(visibleQuestions);
  const root = pruneNode(document.root, visible) ?? { type: "Form", children: [] };
  return { stepId: document.stepId, root };
}
