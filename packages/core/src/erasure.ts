import { z } from "zod";

import { FormId, SessionId } from "./ids.js";

// Erasure is the one exception to the append-only ledger (I5): a whole-session
// delete plus a tombstone, in one transaction, with still no UPDATE path. An
// adopter who adds respondent-linkable columns to `sessions` must extend the
// scrub. It does not propagate to webhook consumers, which are independent data
// controllers, and does not reach backups or replicas (ADR-17, `docs/erasure.md`).

/** `reason` is an operator-supplied note. */
export const EraseRequest = z.object({
  sessionId: SessionId,
  reason: z.string().min(1),
});
export type EraseRequest = z.infer<typeof EraseRequest>;

/**
 * The tombstone that now stands for the session: it records that a response
 * existed and against which form version, and no content. `alreadyErased` is
 * true when an existing tombstone came back unchanged, making this idempotent.
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

/** Execution surfaces one of these as a typed throw. */
export const EraseErrorCode = z.enum(["SESSION_NOT_FOUND"]);
export type EraseErrorCode = z.infer<typeof EraseErrorCode>;
