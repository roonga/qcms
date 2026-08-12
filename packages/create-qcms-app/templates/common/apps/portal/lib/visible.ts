import type { A2UIStepDocument, AuthorMessages } from "@qcms/ui";
import { authorMessagesOf, documentForVisible } from "@qcms/ui";

/**
 * The document conventions the portal reads out of a compiled step (task 029).
 *
 * The visibility projection itself is **not** here. It moved into `@qcms/ui` with
 * task 034, because the admin's draft preview needs the identical projection and
 * a second copy is precisely how "what the author saw" and "what the respondent
 * got" would diverge (ARCHITECTURE §6). It is re-exported below so this module
 * stays the portal's one door to step-document reading.
 *
 * What remains is portal chrome, over the same `name`-prop convention the
 * projection uses. `questionLabels` reads each question's rendered label out of
 * the document so the portal can name a question in shell chrome (the error
 * summary, issue #21) without a second API call: the compiler already resolved
 * `label` onto every control node at publish time (ADR-18). `questionPositions`
 * numbers the same questions down the page, so chrome can still name a question
 * the document gave no label (issue #326). `commitMoments` reads
 * each question's CONTROL KIND out of the same document so the flow knows WHEN
 * each answer commits (ADR-31, issue #31).
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
 * Map each VISIBLE question to its 1-based position among the step's visible
 * questions, in document order (issue #326).
 *
 * This is what makes an error-summary entry for a LABEL-LESS question
 * distinguishable: "Question 3: ..." names a field the respondent can count to,
 * and two label-less questions on one step can never collide, because no two
 * questions share a position. Distinctness is therefore structural - it holds
 * whatever an author types, and cannot regress when content changes, which a
 * label-dependent guarantee cannot promise inside a WCAG 2.2 AA conformance
 * claim (WCAG 3.3.1, Error Identification).
 *
 * The position is the question's place on the PAGE, not its place in the summary.
 * The summary lists only the errored questions, so numbering it would announce
 * "Question 1" for what is the third field on the step: confidently wrong, and
 * worse than the bare message it replaces for someone navigating to find it.
 *
 * `visibleQuestions` is the API's authoritative visible set for this step
 * (ADR-16's forward pass, already in document order) - never a re-evaluation
 * here (R2). Walking the document and keeping only the visible names makes the
 * ordering the DOCUMENT's rather than the list's, so the count matches what the
 * renderer draws (`documentForVisible` prunes on exactly the same predicate).
 * With no document to walk - a completed flow, or a step the API returned
 * nothing for - the list's own order stands in, which is the same order.
 *
 * A question outside the visible set gets no position: it is not drawn, so there
 * is nothing on the page to count to. Callers decide that fallback, as they do
 * for a missing label.
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
 * Map each question in `document` to the author's validation messages, using the
 * same `name`-prop convention as the label walker above (task 048, ADR-32).
 *
 * The messages arrive already resolved for the form's locale, on the control node
 * the compiler emitted at publish time (ADR-18) - so the portal never resolves a
 * `LocalizedText`, never calls the API a second time, and never evaluates
 * anything. A question the author left alone is simply not in the map, and each
 * key inside an entry is independently absent, which is what makes the fallback
 * per-constraint rather than per-question.
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

/**
 * {@link questionMessages} over a possibly-absent document: a completed flow, or
 * a step the API returned nothing for, yields an empty map so callers need no
 * special case.
 */
export function messagesOf(document: A2UIStepDocument | null): ReadonlyMap<string, AuthorMessages> {
  return document === null ? new Map() : questionMessages(document);
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
