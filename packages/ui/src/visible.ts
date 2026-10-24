import type { A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { REPEAT_GROUP_NODE_TYPE } from "./repeat/repeat-node.ts";

/**
 * Presentation over the API's authoritative projection, never a re-evaluation of rules
 * (R2). It lives here because the portal and the admin preview need the identical
 * projection, and a second copy is how the two would quietly diverge (ARCHITECTURE §6).
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
  // The visible set holds qualified names, so a template's bare name can never be in
  // it; the expansion prunes each clone instead, where the instance is known.
  if (node.type === REPEAT_GROUP_NODE_TYPE) return { ...node };
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

/** A copy of `document` holding only the visible questions, plus every layout node. */
export function documentForVisible(
  document: A2UIStepDocument,
  visibleQuestions: readonly string[],
): A2UIStepDocument {
  const visible = new Set(visibleQuestions);
  const root = pruneNode(document.root, visible) ?? { type: "Form", children: [] };
  return { stepId: document.stepId, root };
}
