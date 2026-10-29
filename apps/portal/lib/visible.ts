import type { A2UIStepDocument, AuthorMessages } from "@roonga/qcms-ui";
import { authorMessagesOf, documentForVisible } from "@roonga/qcms-ui";
import { REPEAT_INSTANCE_NODE_TYPE } from "@roonga/qcms-ui/repeat-node";
import { REPEAT_ROW_NODE_TYPE } from "@roonga/qcms-ui/repeat-table-node";

export { documentForVisible };

interface MutableNode {
  type: string;
  props?: Record<string, unknown>;
  children?: MutableNode | MutableNode[] | string;
}

function questionName(node: MutableNode): string | undefined {
  const name = node.props?.name;
  return typeof name === "string" ? name : undefined;
}

function forEachNode(node: MutableNode, visit: (node: MutableNode) => void): void {
  visit(node);
  const { children } = node;
  if (children === undefined || typeof children === "string") return;
  if (Array.isArray(children)) {
    for (const child of children) forEachNode(child, visit);
    return;
  }
  forEachNode(children, visit);
}

/**
 * A question whose label is absent or blank, such as the honeypot, is not in the map;
 * callers decide the fallback.
 */
export function questionLabels(document: A2UIStepDocument): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  forEachNode(document.root, (node) => {
    const name = questionName(node);
    if (name === undefined) return;
    const label = node.props?.label;
    if (typeof label !== "string") return;
    const trimmed = label.trim();
    if (trimmed !== "") labels.set(name, trimmed);
  });
  return labels;
}

export function questionPositions(
  document: A2UIStepDocument | null,
  visibleQuestions: readonly string[],
): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  const record = (name: string): void => {
    if (!positions.has(name)) positions.set(name, positions.size + 1);
  };
  if (document === null) {
    for (const questionId of visibleQuestions) record(questionId);
    return positions;
  }
  const visible = new Set(visibleQuestions);
  forEachNode(document.root, (node) => {
    const name = questionName(node);
    if (name === undefined || !visible.has(name)) return;
    record(name);
  });
  return positions;
}

/**
 * The messages arrive already resolved for the form's locale on the control node the
 * compiler emitted (ADR-18), so the portal resolves no `LocalizedText` and calls the API
 * no second time. Each key inside an entry is independently absent, which is what makes
 * the fallback per constraint rather than per question.
 */
export function questionMessages(document: A2UIStepDocument): ReadonlyMap<string, AuthorMessages> {
  const messages = new Map<string, AuthorMessages>();
  forEachNode(document.root, (node) => {
    const name = questionName(node);
    if (name === undefined) return;
    const authored = authorMessagesOf(node.props);
    if (authored !== undefined) messages.set(name, authored);
  });
  return messages;
}

/** An absent document yields an empty map, so callers need no special case. */
export function messagesOf(document: A2UIStepDocument | null): ReadonlyMap<string, AuthorMessages> {
  return document === null ? new Map() : questionMessages(document);
}

export type CommitMoment = "change" | "completion" | "blur" | "groupExit";

const COMMIT_MOMENT_BY_CONTROL: ReadonlyMap<string, CommitMoment> = new Map<string, CommitMoment>([
  ["RadioGroup", "change"],
  ["Select", "change"],
  ["DatePicker", "completion"],
  ["NumberField", "blur"],
  ["TextArea", "blur"],
  ["TextField", "blur"],
  ["CheckboxGroup", "groupExit"],
]);

// The conservative default for a control the map above does not name, so an unrecognised
// one can never post mid-entry.
export const DEFAULT_COMMIT_MOMENT: CommitMoment = "blur";

/**
 * Reading the control kind out of the compiled document is what separates a
 * `singleChoice`, which commits on change, from a `date` or a `longText`, which are also
 * strings and commit later. Presentation over the API's projection, never rule
 * evaluation (R2).
 */
export function commitMoments(document: A2UIStepDocument): ReadonlyMap<string, CommitMoment> {
  const moments = new Map<string, CommitMoment>();
  forEachNode(document.root, (node) => {
    const name = questionName(node);
    if (name === undefined) return;
    const moment = COMMIT_MOMENT_BY_CONTROL.get(node.type);
    if (moment !== undefined) moments.set(name, moment);
  });
  return moments;
}

export function instanceLabels(document: A2UIStepDocument | null): ReadonlyMap<string, string> {
  const byField = new Map<string, string>();
  if (document === null) return byField;
  const walk = (node: MutableNode, label: string | undefined): void => {
    const labelled = node.type === REPEAT_INSTANCE_NODE_TYPE || node.type === REPEAT_ROW_NODE_TYPE;
    const own = labelled ? node.props?.label : undefined;
    const scope = typeof own === "string" ? own : label;
    const name = questionName(node);
    if (name !== undefined && scope !== undefined) byField.set(name, scope);
    const { children } = node;
    if (children === undefined || typeof children === "string") return;
    if (Array.isArray(children)) {
      for (const child of children) walk(child, scope);
      return;
    }
    walk(children, scope);
  };
  walk(document.root, undefined);
  return byField;
}
