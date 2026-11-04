/** When an action removes its trigger, focus the successor heading, not the live region that would announce twice. Repeat one frame later to win the React Aria restore race. */
export function focusPostAction(target: HTMLElement | null): (() => void) | undefined {
  if (target === null) return undefined;
  target.focus();
  const frame = requestAnimationFrame(() => {
    target.focus();
  });
  return () => {
    cancelAnimationFrame(frame);
  };
}

export const TOMBSTONE_HEADING_ID = "qcms-tombstone-heading";

/** Bound request lifetime and match subject identity so unrelated tombstones cannot steal a stale focus request. */
const REQUEST_TTL_MS = 5_000;

/** Match the action subject as well as element ID; multiple successor screens render the same heading ID. */
let pending: { readonly elementId: string; readonly subject: string; readonly at: number } | null =
  null;

/** Store focus hand-offs outside the component because route revalidation can replace the entire subtree after its first focus move. */
export function requestPostActionFocus(elementId: string, subject: string): void {
  pending = { elementId, subject, at: Date.now() };
}

/** A different subject must neither consume nor satisfy this request; ordinary visits have no focus request. */
export function claimPostActionFocus(elementId: string, subject: string): (() => void) | undefined {
  if (pending === null) return undefined;
  if (pending.elementId !== elementId || pending.subject !== subject) return undefined;
  if (Date.now() - pending.at > REQUEST_TTL_MS) {
    pending = null;
    return undefined;
  }
  pending = null;
  return focusPostAction(document.getElementById(elementId));
}
