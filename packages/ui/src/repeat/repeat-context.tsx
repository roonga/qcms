import { createContext, useContext } from "react";

/**
 * The host behaviour a repeat node cannot carry. Without scripting none of it exists:
 * Add and Remove are `__qop` submit buttons, and 4.1.3 does not apply, since it scopes
 * out a message delivered via a change in context.
 */
export interface QcmsRepeatContextValue {
  /** Scripted only: ask the host to add an instance to this group. */
  readonly onAdd?: (groupId: string) => void;
  /** Scripted only: ask the host to remove this instance. */
  readonly onRemove?: (groupId: string, instanceId: string) => void;
  /**
   * A whole sentence, never a changing number, because 4.1.3's Understanding warns that
   * updating only the digit in "3 items" can announce just "three". Named by group, so
   * a step holding two announces beside the one that changed.
   */
  readonly status?: { readonly groupId: string; readonly message: string };
  /** The group a roster write is currently in flight for, so its controls can wait. */
  readonly busyGroupId?: string;
  /**
   * An instance id, or a group's Add button id when a removal emptied the group.
   *
   * Without scripting it becomes `autofocus` rather than a fragment, because a 200
   * answering a POST leaves the browser on the POST's own URL. Never combine the two:
   * the flush algorithm skips `autofocus` when the document has a fragment target.
   */
  readonly autofocusId?: string;
}

const EMPTY: QcmsRepeatContextValue = Object.freeze({});

export const QcmsRepeatContext = createContext<QcmsRepeatContextValue>(EMPTY);

/**
 * Unlike `useQcmsField` this does not throw without a provider: a group renders
 * correctly with no behaviour at all, as the no-JS path and a version view both do.
 */
export function useQcmsRepeat(): QcmsRepeatContextValue {
  return useContext(QcmsRepeatContext);
}
