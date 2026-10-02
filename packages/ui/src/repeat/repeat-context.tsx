import { createContext, useContext } from "react";

/**
 * What a rendered repeat control needs that its node cannot carry (task 073).
 *
 * The node carries the group's stored content and this render's roster facts; the
 * two callbacks and the announcement are the **host's** behaviour, and they differ
 * between the two paths by design:
 *
 * - **Scripted**: `onAdd` and `onRemove` post the roster operation to the BFF and
 *   re-render, and `status` is the sentence a `role="status"` region announces.
 * - **Without scripting**: neither callback exists, and the Add and Remove controls
 *   render as named submit buttons (`__qop`) on the step's own form. 4.1.3 does not
 *   apply there - the criterion scopes out messages delivered "via a change in
 *   context", and a whole-page POST and re-render is exactly that - so there is no
 *   live region on that path and the landing is an `autofocus` attribute instead
 *   (Q28, ruled 2026-10-01). This sentence used to say "a fragment", which the
 *   `autofocusId` doc below already contradicted.
 */
export interface QcmsRepeatContextValue {
  /** Scripted only: ask the host to add an instance to this group. */
  readonly onAdd?: (groupId: string) => void;
  /** Scripted only: ask the host to remove this instance. */
  readonly onRemove?: (groupId: string, instanceId: string) => void;
  /**
   * Scripted only: the whole sentence to announce, and which group it belongs to.
   *
   * A whole sentence and never a changing number, because 4.1.3's own Understanding
   * warns that updating only the digit in "3 items" can announce just "three". It
   * names its group so a step holding two groups announces in the region beside the
   * one that changed rather than in both.
   */
  readonly status?: { readonly groupId: string; readonly message: string };
  /** The group a roster write is currently in flight for, so its controls can wait. */
  readonly busyGroupId?: string;
  /**
   * The DOM id this render should land focus on: an instance id after an add or a
   * removal, or a group's Add button id when a removal emptied the group (Q11).
   *
   * **On the no-JS path this becomes an `autofocus` attribute**, and that is the ruled
   * mechanism (Code Owner, 2026-10-01). The Add and Remove post answers with a **200**
   * re-render rather than a redirect, and a 200 to a POST leaves the browser on the
   * POST's own URL, which carries no fragment, so a fragment cannot be the landing.
   * `autofocus` applies to every element and not only to form controls (HTML), and a
   * negative `tabindex` makes the heading a focusable area, so the heading is a legal
   * target. The two must never be combined: the flush algorithm skips `autofocus`
   * outright when the document has a fragment target, so a page carrying both would
   * land nowhere it intended.
   *
   * On the scripted path the host moves focus itself and this is the same destination
   * expressed once, so the two paths cannot drift.
   */
  readonly autofocusId?: string;
}

const EMPTY: QcmsRepeatContextValue = Object.freeze({});

export const QcmsRepeatContext = createContext<QcmsRepeatContextValue>(EMPTY);

/**
 * The repeat behaviour for this render. Unlike `useQcmsField` this does **not**
 * throw without a provider: a repeat group renders correctly with no behaviour at
 * all (the no-JS path has none, and the admin's version view has none either), and
 * the default is the empty object rather than an error.
 */
export function useQcmsRepeat(): QcmsRepeatContextValue {
  return useContext(QcmsRepeatContext);
}
