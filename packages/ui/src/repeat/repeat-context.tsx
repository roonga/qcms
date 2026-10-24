import { createContext, useContext } from "react";

/**
 * What a rendered repeat control needs that its node cannot carry.
 *
 * The node carries the group's stored content and this render's roster facts; the
 * callbacks and the announcement are the host's behaviour, and they differ between
 * the two paths:
 *
 * - Scripted: `onAdd` and `onRemove` post the roster operation and re-render, and
 *   `status` is the sentence a `role="status"` region announces.
 * - Without scripting: neither callback exists, and Add and Remove render as named
 *   `__qop` submit buttons on the step's own form. 4.1.3 does not apply there, since
 *   it scopes out messages delivered via a change in context and a whole-page POST
 *   and re-render is exactly that, so there is no live region and the landing is an
 *   `autofocus` attribute instead.
 */
export interface QcmsRepeatContextValue {
  /** Scripted only: ask the host to add an instance to this group. */
  readonly onAdd?: (groupId: string) => void;
  /** Scripted only: ask the host to remove this instance. */
  readonly onRemove?: (groupId: string, instanceId: string) => void;
  /**
   * Scripted only: the whole sentence to announce, and which group it belongs to.
   *
   * A whole sentence and never a changing number, because 4.1.3's Understanding warns
   * that updating only the digit in "3 items" can announce just "three". It names its
   * group so a step holding two groups announces beside the one that changed.
   */
  readonly status?: { readonly groupId: string; readonly message: string };
  /** The group a roster write is currently in flight for, so its controls can wait. */
  readonly busyGroupId?: string;
  /**
   * The DOM id this render should land focus on: an instance id after an add or a
   * removal, or a group's Add button id when a removal emptied the group.
   *
   * On the no-JS path it becomes an `autofocus` attribute, which is the ruled
   * mechanism: Add and Remove answer with a 200 re-render rather than a redirect, and
   * a 200 to a POST leaves the browser on the POST's own URL, which carries no
   * fragment. A negative `tabindex` makes the heading a focusable area, so it is a
   * legal `autofocus` target. Never combine the two: the flush algorithm skips
   * `autofocus` outright when the document has a fragment target.
   *
   * On the scripted path the host moves focus itself, to the same destination
   * expressed once, so the two paths cannot drift.
   */
  readonly autofocusId?: string;
}

const EMPTY: QcmsRepeatContextValue = Object.freeze({});

export const QcmsRepeatContext = createContext<QcmsRepeatContextValue>(EMPTY);

/**
 * The repeat behaviour for this render. Unlike `useQcmsField` this does not throw
 * without a provider: a repeat group renders correctly with no behaviour at all, as
 * the no-JS path and the admin's version view both do.
 */
export function useQcmsRepeat(): QcmsRepeatContextValue {
  return useContext(QcmsRepeatContext);
}
