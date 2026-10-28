/**
 * Flow-level accessibility helpers: announcing step and branch changes, and managing
 * focus when a branch change inserts or removes a question.
 *
 * Focus targets rely on the questionId-keyed handle `@roonga/qcms-ui` stamps on every
 * control, so the portal never reverse-engineers a control type's internal DOM.
 */

export interface FlowView {
  /**
   * The rendered step document's id, deliberately not `flowState.currentStep`, which
   * also flips to `null` merely because the flow became ready to submit.
   */
  readonly stepId: string | null;
  /**
   * The instance this page draws when a `perInstanceStep` group paginates the step. Two
   * views of one step carry the same `stepId`, so without this a Continue between two
   * instances is a navigation by every respondent-visible measure and by none the
   * `stepId` can take.
   */
  readonly instanceId: string | null;
  readonly stepIndex: number;
  readonly visibleQuestions: readonly string[];
}

export interface FlowDelta {
  readonly stepChanged: boolean;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/**
 * `stepChanged` is a move between two real views: a step going to `null` is the flow
 * completing rather than a navigation to announce, and a `stepIndex` change alone is
 * progress. A first render reports no delta, since focus is where the SSR left it.
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
    previous.stepId !== null &&
    next.stepId !== null &&
    (previous.stepId !== next.stepId || previous.instanceId !== next.instanceId);
  return { stepChanged, added, removed };
}

/**
 * The next question that was visible after the removed one and still is, in pre-change
 * document order, or `undefined` when nothing follows and the caller falls back to the
 * step heading.
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

function canTakeFocus(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false;
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ visibilityProperty: true });
  }
  return true;
}

/**
 * Prefers the value control over a control's ancillary buttons, such as a NumberField's
 * steppers, and skips anything inside an `aria-hidden` subtree, such as the honeypot or
 * a hidden native select mirror.
 */
export function firstFocusableIn(root: ParentNode): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.closest("[aria-hidden='true']") === null && canTakeFocus(element),
  );
  // A segmented date field's value control is its first editable segment, a
  // `[role=spinbutton]` span. Checked first because such a field also renders a native
  // text input for soft-keyboard entry, which must not win on a platform that shows it.
  const dateSegment = candidates.find((element) => element.getAttribute("role") === "spinbutton");
  const valueControl = candidates.find((element) =>
    /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName),
  );
  return dateSegment ?? valueControl ?? candidates[0] ?? null;
}

export function questionIdOf(element: Element | null): string | undefined {
  const field = element?.closest<HTMLElement>("[data-qcms-field]");
  return field?.dataset.qcmsField || undefined;
}

/**
 * Returns true only when focus actually landed inside that question, so the
 * branch-removal recovery can fall back to the step heading rather than believe focus
 * moved. Anything inside the field counts, since a component may delegate focus to a
 * descendant. `scrollIntoView` keeps the control on screen at 200% zoom.
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

/**
 * A minimal `CSS.escape` shim. It is load-bearing rather than defensive: a repeated
 * question's field name carries Q15's `/` separator, which is legal in an HTML id and
 * has to stay legal inside an attribute selector.
 */
export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
