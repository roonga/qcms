import type { A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { REPEAT_GROUP_NODE_TYPE } from "./repeat/repeat-node.ts";

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
 * It lives in `@roonga/qcms-ui` rather than in either app because **both** consumers
 * need the identical projection: the portal serving a respondent (task 029) and
 * the admin previewing a draft (task 034). Preview fidelity is the reason
 * `@roonga/qcms-ui` exists at all (ARCHITECTURE §6), and a second copy of this function
 * is exactly how "what the author saw" and "what the respondent got" would
 * quietly diverge - the same argument that keeps `A2UIStepRenderer` singular.
 *
 * A node is a question control iff it carries a string `name` prop (the
 * questionId, per the a2ui mapping); such a node is dropped unless its name is in
 * the visible set. Layout and text nodes (no `name`) are always kept, with their
 * children pruned recursively. The root is never a question node, so it survives.
 *
 * **A `RepeatGroup` template is kept whole and pruned nowhere here** (task 073,
 * ADR-42, ADR-43), and that is a necessity rather than an exemption. A rule whose
 * target is inside a group is evaluated once per **live instance**, so a member
 * question can be visible in instance 1 and hidden in instance 2; the visible set is
 * therefore a set of **qualified** names (`ins_7k2/q_plate`) and a template's bare
 * `q_plate` can never be in it. Pruning here would delete every member control before
 * the renderer had a chance to clone one. `expandRepeatGroups` prunes each clone
 * against this same set instead, where the instance is known, which is exactly what
 * "the qualified name is the field's whole identity below the API" means at this seam.
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
  // A repeating group's members are pruned per instance by the renderer's expansion,
  // against the qualified names this set actually holds. See the docblock above.
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
