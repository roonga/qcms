import { z } from "zod";

import { FormId, SessionId } from "./ids.js";

// Erasure is the one exception to the append-only ledger (I5): session delete plus tombstone
// in one transaction. Adopters adding respondent-linkable `sessions` columns must extend the
// scrub. Not propagated to webhook consumers or backups (ADR-17, `docs/erasure.md`).

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
