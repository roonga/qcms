import type { A2UIStepDocument, AuthorMessages } from "@roonga/qcms-ui";
import { authorMessagesOf, documentForVisible } from "@roonga/qcms-ui";
import { REPEAT_INSTANCE_NODE_TYPE } from "@roonga/qcms-ui/repeat-node";
import { REPEAT_ROW_NODE_TYPE } from "@roonga/qcms-ui/repeat-table-node";

/**
 * The document conventions the portal reads out of a compiled step, over the `name`-prop
 * convention the visibility projection uses.
 *
 * That projection lives in `@roonga/qcms-ui`, because the admin's draft preview needs an
 * identical one and a second copy is how "what the author saw" and "what the respondent
 * got" would diverge (ARCHITECTURE section 6). It is re-exported here so this module
 * stays the portal's one door to step-document reading.
 */

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

/**
 * What makes an error-summary entry for a label-less question distinguishable (WCAG
 * 3.3.1): no two questions share a position, so distinctness is structural and cannot
 * regress when an author edits content.
 *
 * The position is the question's place on the page and not in the summary, which lists
 * only the errored questions and would therefore call the third field on the step
 * "Question 1".
 *
 * `visibleQuestions` is the API's set, never a re-evaluation here (R2). Walking the
 * document and keeping only the visible names makes the ordering the document's, so the
 * count matches what the renderer draws. With no document to walk, the list's own order
 * stands in, which is the same order.
 */
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

/**
 * When one answer commits (ADR-31). Commitment is a property of the control rather than
 * of the value: it is the moment the respondent has finished saying this one thing.
 *
 * `completion` is a control entered piecewise, where only a complete value is an answer
 * at all, so it can never send `null` for an entry the respondent has not finished.
 * `groupExit` is a multi-select, where per-toggle posting produces `contains` churn and
 * threshold flapping.
 *
 * The server remains the only rule evaluator (R2); this governs posting cadence only.
 */
export type CommitMoment = "change" | "completion" | "blur" | "groupExit";

/**
 * Keyed by the A2UI control the compiler emits rather than by the question type, because
 * the compiled step document carries the control and not the type.
 *
 * `DatePicker` commits when editing ends rather than when every segment is filled: the
 * vendored react-aria control's only completeness signal is a non-empty value, which it
 * raises on every digit typed into the year, so typing 1990 would post four complete
 * dates and take three refusals on the way.
 */
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

/**
 * The error summary needs this, or an entry naming a repeated question by its own label
 * reads identically once per instance, which is WCAG 3.3.1's distinctness problem.
 *
 * It reads the nodes the renderer's expansion produced, so the document handed here must
 * be the expanded one.
 *
 * Two node types carry an instance label, one per presentation, and they are listed
 * rather than inferred because the consequence of missing one is silent: that
 * presentation's summary loses its instance names.
 *
 * The instance id is never the label: the map carries the authored `instanceLabel` with
 * its live ordinal resolved (ADR-42).
 */
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
