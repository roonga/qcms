/**
 * The type-to-confirm rule for erasure (task 035, ADR-17).
 *
 * Erasure is the one operation in this product with no inverse. `POST
 * /admin/sessions/{id}/erase` deletes the answers and the submission and writes a
 * tombstone in a single transaction; there is no soft-delete column, no archive
 * table, and nothing this app or its operator can restore from. R3 names it as the
 * sole DELETE door in the system, and it is a door that only opens outward.
 *
 * So the confirmation is not a courtesy "are you sure" - it is a deliberate cost
 * placed in front of an irreversible act. The operator retypes the session id, which
 * means the destructive press cannot be reached by muscle memory, by a stray Enter on
 * a focused dialog, or by a mis-click on the row below the one they meant. That is
 * exit criterion 2's "no single-click path", stated as a function so a test can hold
 * the product to it rather than a reviewer having to re-read the component.
 *
 * The match is exact after trimming, and case-sensitive. A session id is machine
 * text (`ses_…`), so a case-insensitive match would accept something the operator
 * did not read off the screen, which is the whole point of asking.
 */

/** Whether what the operator typed authorises erasing this session. */
export function isErasureConfirmed(typed: string, sessionId: string): boolean {
  if (sessionId === "") return false;
  return typed.trim() === sessionId;
}

/**
 * The reasons an erasure can be recorded under.
 *
 * A closed set rather than free text, because the reason is compliance evidence
 * stored on the tombstone: a fixed vocabulary is what makes the erasure log
 * countable and comparable, and it keeps an operator from typing a data subject's
 * name into an audit record that outlives the data it describes.
 */
export const ERASURE_REASONS = ["subject_request", "retention_policy", "operator_error"] as const;

export type ErasureReason = (typeof ERASURE_REASONS)[number];

/** The default reason: the one an ADR-17 erasure is overwhelmingly performed for. */
export const DEFAULT_ERASURE_REASON: ErasureReason = "subject_request";

/** Whether a string is one of the recorded reasons. */
export function isErasureReason(value: string): value is ErasureReason {
  return (ERASURE_REASONS as readonly string[]).includes(value);
}
