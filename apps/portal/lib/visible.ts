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
 *
 * The same convention drives `questionLabels`, which reads each question's
 * rendered label out of the document so the portal can name a question in shell
 * chrome (the error summary, issue #21) without a second API call: the compiler
 * already resolved `label` onto every control node at publish time (ADR-18), and
 * `commitMoments`, which reads each question's CONTROL KIND out of the same
 * document so the flow knows WHEN each answer commits (ADR-31, issue #31).
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

/** Visit `node` and every descendant, in document order. */
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
 * Map each question in `document` to its rendered label, using the same
 * `name`-prop convention as the visibility projection above. A question whose
 * label is absent or blank (a control the compiler gave no label, e.g. the
 * honeypot) is simply not in the map - callers decide the fallback.
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
 * When one answer COMMITS, per ADR-31 ("answer commitment semantics and
 * conditional reveal cadence"). Commitment is a property of the CONTROL, not of
 * the value: it is the moment the respondent has finished saying this one thing,
 * and therefore the moment the portal posts the answer and applies the server's
 * re-evaluation (same-step reveal follows the commit, for every control).
 *
 * - `change` - every change event is already a whole answer (one click or one
 *   keypress selects it). Post immediately.
 * - `completion` - the control is entered piecewise and only a COMPLETE value is
 *   an answer at all. A partial value is never posted, so this control can never
 *   send `null` for an entry the respondent simply has not finished.
 * - `blur` - free entry, where every change is a keystroke. Post when focus
 *   leaves the control.
 * - `groupExit` - a multi-select, which has no natural per-change commit at all
 *   (ADR-31: per-toggle posting produces `contains` churn, threshold flapping
 *   around `count >= 2`, and retained-answer re-reveals). Post when focus leaves
 *   the whole GROUP, not when it moves between the group's own checkboxes.
 *
 * The server remains the only rule evaluator (R2); commitment governs the
 * client's posting cadence only.
 */
export type CommitMoment = "change" | "completion" | "blur" | "groupExit";

/**
 * ADR-31's commitment table, keyed by the A2UI control the compiler emits for
 * each question type (`docs/a2ui-mapping.md`) rather than by the question type,
 * because the compiled step document carries the control and not the type.
 *
 * | question type | control | commit moment |
 * | --- | --- | --- |
 * | boolean | `RadioGroup` (true/false) | change |
 * | singleChoice, up to 7 options | `RadioGroup` (one Radio per option) | change |
 * | singleChoice, above 7 options | `Select` | change |
 * | date | `DatePicker` | completion |
 * | number | `NumberField` | blur |
 * | longText | `TextArea` | blur |
 * | multiChoice | `CheckboxGroup` | groupExit |
 * | shortText | `TextField` | blur |
 *
 * `shortText` is the one row ADR-31's table does not list. It is read here as
 * UNCHANGED (blur), which is both its behavior today and the only reading
 * consistent with the other free-entry rows: a `TextField` emits a change per
 * keystroke, so any earlier moment would be a request per character. Flagged for
 * the Code Owner to confirm or amend the ADR rather than assumed silently.
 *
 * OPEN, AWAITING THE CODE OWNER (`date`): ADR-31 says "on completion (all
 * segments filled)". The vendored react-aria DatePicker's ONLY completeness
 * signal is a non-empty value, and it raises that on every digit typed into the
 * year, because a year segment holding "1" is a filled segment: typing 1990
 * emits the complete dates 0001-05-17, 0019-05-17, 0199-05-17 and then
 * 1990-05-17. Posting each is four appends, three API 422s and three visible
 * "invalid value" flashes, and a same-step branch gated on the date would flicker
 * through four projections - precisely the mid-interaction churn ADR-31 exists to
 * prevent. There is no control-level signal that separates "the year is filled"
 * from "the respondent has finished typing the year" (a digit count or a debounce
 * would be an approximation, not a signal). So `completion` is implemented here
 * as ALL SEGMENTS FILLED AS A PRECONDITION, committed when editing ends: a
 * partial date never posts (which today's code does, as `null`), and the complete
 * date posts once. That is strictly better than the behavior it replaces but it
 * is NOT the ADR's literal trigger, and it collapses a distinction from `number`
 * / `longText` that the Code Owner drew deliberately. Confirm or amend ADR-31
 * before treating the date row as settled.
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

/**
 * The moment at which a control commits is the conservative default for anything
 * the table above does not name: post only once focus has left it, so an
 * unrecognized control can never post mid-entry.
 */
export const DEFAULT_COMMIT_MOMENT: CommitMoment = "blur";

/**
 * Map each question in `document` to its ADR-31 commit moment, using the same
 * `name`-prop convention as the visibility projection above (issue #31).
 *
 * Reading the control kind out of the compiled document is what separates a
 * `singleChoice` (a string OptionId, commits on change) from a `date` or a
 * `longText` (also strings, commit later), which the flow cannot tell apart from
 * the value alone - the bug behind issue #31, where a `singleChoice` gating a
 * same-step question revealed it only after focus left the radio group. Still
 * presentation over the API's projection, never rule evaluation (R2).
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
