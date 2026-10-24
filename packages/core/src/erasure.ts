import { z } from "zod";

import { FormId, SessionId } from "./ids.js";

/**
 * Erasure semantics (ADR-17, I11). This package owns the meaning of erasure and
 * `@roonga/qcms-db` owns its execution, so this module is pure (R3). The
 * operator guide is `docs/erasure.md`.
 *
 * Erasure is the one exception to the append-only ledger (I5): still no UPDATE
 * path anywhere, but a whole-session delete plus a tombstone in one
 * transaction. An adopter who adds respondent-linkable columns to `sessions`
 * must extend the scrub, which is empty in the launch schema.
 *
 * The tombstone preserves that a response existed and against which form
 * version, without preserving any content, and carries no foreign key to
 * `sessions`, so it survives a later retention purge of the scrubbed shell.
 * The reporting view excludes erased sessions by anti-join, independently of
 * the hard delete.
 *
 * Erasure does not propagate to webhook consumers, which are independent data
 * controllers, and does not reach physical backups or replicas (ADR-17).
 */

/** `reason` is an operator-supplied note. */
export const EraseRequest = z.object({
  sessionId: SessionId,
  reason: z.string().min(1),
});
export type EraseRequest = z.infer<typeof EraseRequest>;

/**
 * The tombstone that now stands for the session. `alreadyErased` is true when
 * the existing tombstone was returned unchanged, which is what makes the
 * operation idempotent.
 */
export const EraseOutcome = z.object({
  sessionId: SessionId,
  formId: FormId,
  formVersion: z.number().int(),
  erasedAt: z.date(),
  reason: z.string().min(1),
  alreadyErased: z.boolean(),
});
export type EraseOutcome = z.infer<typeof EraseOutcome>;

/**
 * Why an erasure could not be performed. Execution surfaces it as a typed
 * throw whose `code` is one of these.
 */
export const EraseErrorCode = z.enum(["SESSION_NOT_FOUND"]);
export type EraseErrorCode = z.infer<typeof EraseErrorCode>;
