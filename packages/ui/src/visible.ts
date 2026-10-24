import type { A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { REPEAT_GROUP_NODE_TYPE } from "./repeat/repeat-node.ts";

/**
 * Project a compiled step document onto an authoritative visible set.
 *
 * The API serves the full compiled step document (ADR-18) plus the forward pass's
 * `visibleQuestions` list (ADR-16), and the renderer draws whatever tree it is handed,
 * so something has to drop the questions the flow says are hidden. This is presentation
 * over an authoritative projection, never a re-evaluation of rules (R2).
 *
 * It lives in `@roonga/qcms-ui` because both the portal and the admin preview need the
 * identical projection, and a second copy is how what the author saw and what the
 * respondent got would quietly diverge (ARCHITECTURE §6).
 *
 * A node is a question control exactly when it carries a string `name` prop, and such a
 * node is dropped unless its name is in the visible set. Layout and text nodes are kept
 * with their children pruned recursively.
 *
 * A `RepeatGroup` template is kept whole out of necessity: a rule inside a group is
 * evaluated once per live instance, so the visible set holds qualified names
 * (`ins_7k2/q_plate`) and a template's bare `q_plate` can never be in it. Pruning here
 * would delete every member control before the renderer could clone one.
 * `expandRepeatGroups` prunes each clone against the same set, where the instance is
 * known.
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
  // A group's members are pruned per instance by the renderer's expansion, against the
  // qualified names this set actually holds.
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
