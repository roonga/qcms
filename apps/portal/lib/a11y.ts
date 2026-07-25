/**
 * Flow-level accessibility helpers for the respondent flow (task 030).
 *
 * The portal owns the two accessibility behaviors a component library cannot
 * supply on its own: announcing branch/step changes through an `aria-live`
 * region, and managing focus when a branch change inserts or removes a question.
 * The pure diff/target functions here are unit-tested; the DOM focus helpers are
 * exercised by the Playwright keyboard walkthrough.
 *
 * Focus targets rely on the questionId-keyed handle @qcms/ui stamps on every
 * control (`[data-qcms-field]`, `id={questionId}`, task 030): the portal never
 * reverse-engineers a control type's internal DOM.
 */

/** The minimal flow view the diff needs (a projection of the API's StepResponse). */
export interface FlowView {
  /**
   * The id of the step DOCUMENT currently rendered (`snapshot.step.stepId`), or
   * `null` when no step is shown. This is the basis for a step-change
   * announcement - deliberately NOT `flowState.currentStep`, which also flips to
   * `null` merely because the flow became ready to submit within the same step.
   */
  readonly stepId: string | null;
  readonly stepIndex: number;
  readonly visibleQuestions: readonly string[];
}

/** What changed between two consecutive flow projections. */
export interface FlowDelta {
  /** The respondent moved to a different step (heading + question set change). */
  readonly stepChanged: boolean;
  /** Questions newly visible (branch inserted), in the new projection's order. */
  readonly added: readonly string[];
  /** Questions no longer visible (branch removed), in the old projection's order. */
  readonly removed: readonly string[];
}

/**
 * Diff two flow projections. `added`/`removed` are pure set differences over the
 * visible-question lists. `stepChanged` is a move between two REAL steps (both
 * step ids non-null and different): a step going to `null` is the flow completing
 * or becoming ready to submit, not a navigation to announce, and a mere
 * `stepIndex` change within the same step (readiness/progress) is not a step
 * change either. A first render (no previous view) reports no delta - there is
 * nothing to announce and focus is already where the SSR left it.
 */
export function diffFlow(previous: FlowView | undefined, next: FlowView): FlowDelta {
  if (previous === undefined) {
    return { stepChanged: false, added: [], removed: [] };
  }
  const prevVisible = new Set(previous.visibleQuestions);
  const nextVisible = new Set(next.visibleQuestions);
  const added = next.visibleQuestions.filter((q) => !prevVisible.has(q));
  const removed = previous.visibleQuestions.filter((q) => !nextVisible.has(q));
  const stepChanged =
    previous.stepId !== null && next.stepId !== null && previous.stepId !== next.stepId;
  return { stepChanged, added, removed };
}

/**
 * Where focus should land when the currently-focused question is removed by a
 * branch change (policy, task 030): the next question that was visible *after*
 * the removed one and still is, in the pre-change document order. Returns
 * `undefined` when nothing follows - the caller then falls back to the step
 * heading. If the removed question was not actually focused (or is still
 * visible), there is nothing to recover and this returns `undefined`.
 */
export function nextFocusTargetAfterRemoval(
  previousOrder: readonly string[],
  removedQuestionId: string,
  nextVisible: ReadonlySet<string>,
): string | undefined {
  const removedIndex = previousOrder.indexOf(removedQuestionId);
  if (removedIndex === -1) return undefined;
  for (let i = removedIndex + 1; i < previousOrder.length; i += 1) {
    const candidate = previousOrder[i];
    if (candidate !== undefined && nextVisible.has(candidate)) return candidate;
  }
  return undefined;
}

const FOCUSABLE_SELECTOR = [
  "input:not([type='hidden']):not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "button:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Whether an element can actually take focus in the layout as rendered. `.focus()`
 * is silent when it fails, so a candidate the browser does not render would make
 * `focusQuestion` report a success that never happened (issue #76).
 *
 * `getClientRects().length === 0` is the primary test: it is zero for
 * `display: none` (the element's own or inherited) and for a detached node, and
 * unlike `offsetParent === null` it does not misreport a `position: fixed`
 * element as hidden. `checkVisibility` then adds the cases that DO generate boxes
 * yet still refuse focus (`visibility: hidden`, `content-visibility: hidden`); it
 * is feature-detected because it is newer than the rest of this file's baseline.
 *
 * Deliberately NOT a visually-hidden test: a clipped 1x1 control can be a real
 * focus target (that is how skip links are built). The visually-hidden native
 * mirrors that must be skipped are excluded by the `aria-hidden` filter instead.
 *
 * Only ever evaluated in a browser: jsdom performs no layout, so every element
 * there reports zero client rects. That is why this file's DOM helpers are
 * covered by Playwright and not by the portal's node-env Vitest project.
 */
function canTakeFocus(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false;
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ visibilityProperty: true });
  }
  return true;
}

/**
 * The control a screen reader should land on for a question: prefer the value
 * control (input / textarea / select, or a radio group's first radio) over a
 * control's ancillary buttons (a NumberField renders stepper `<button>`s around
 * its input) and over trigger buttons. Skips anything inside an `aria-hidden`
 * subtree (e.g. the honeypot, or a hidden native select mirror) and anything the
 * browser does not render, which `.focus()` would silently ignore.
 */
export function firstFocusableIn(root: ParentNode): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.closest("[aria-hidden='true']") === null && canTakeFocus(element),
  );
  // A segmented date field's value control is its first editable SEGMENT, which
  // react-aria renders as a `[role=spinbutton]` span rather than an input. Checked
  // before the input preference because such a field also renders a native text
  // input for soft-keyboard entry: it is `display: none` on pointer platforms, but
  // it must not win the preference below on a platform where it is rendered.
  const dateSegment = candidates.find((element) => element.getAttribute("role") === "spinbutton");
  const valueControl = candidates.find((element) =>
    /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName),
  );
  return dateSegment ?? valueControl ?? candidates[0] ?? null;
}

/** The questionId of the field wrapper an element sits inside, if any. */
export function questionIdOf(element: Element | null): string | undefined {
  const field = element?.closest<HTMLElement>("[data-qcms-field]");
  return field?.dataset.qcmsField || undefined;
}

/**
 * Move focus to a question's value control by questionId, scoped to `root`.
 * Returns true only when focus ACTUALLY landed inside that question: `.focus()`
 * reports nothing when it fails, and the caller that branches on this result (the
 * branch-removal recovery in `step-flow`) must fall back to the step heading
 * rather than believe focus moved and leave it wherever it was (issue #76).
 * Anything inside the field counts, since a component may delegate focus from the
 * element we picked to a descendant of it. `scrollIntoView` keeps the newly
 * focused control on screen at 200% zoom / small viewports.
 */
export function focusQuestion(root: ParentNode, questionId: string): boolean {
  const field = root.querySelector<HTMLElement>(`[data-qcms-field="${cssEscape(questionId)}"]`);
  if (field === null) return false;
  const control = firstFocusableIn(field);
  if (control === null) return false;
  control.focus();
  if (!field.contains(field.ownerDocument.activeElement)) return false;
  control.scrollIntoView({ block: "center", behavior: "auto" });
  return true;
}

/** Minimal CSS.escape shim (questionIds are `q_…`, but stay defensive). */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
