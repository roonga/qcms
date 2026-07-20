import { z } from "zod";

import { FormId, SessionId } from "./ids.js";

/**
 * Erasure semantics (task 016, ADR-17, invariant I11). `@qcms/core` owns the
 * *meaning* of erasure; `@qcms/db` owns its *execution* (`eraseSession`). This
 * module is pure — it defines the request/outcome shapes and states what
 * erasure asserts. No I/O (R3).
 *
 * ## What erasure is
 *
 * A right-to-erasure operation over a single respondent **session**. It is the
 * one and only exception to the append-only ledger rule (R3/I5): there is still
 * no UPDATE path anywhere; erasure is a whole-session DELETE plus a tombstone,
 * performed in a single transaction.
 *
 * ## What is deleted
 *
 * - Every `answers` row for the session (the append-only answer ledger).
 * - The `submissions` lock row, if the session was submitted.
 * - Any session column that could hold respondent-linkable data is scrubbed.
 *   In the launch schema the `sessions` table holds **no** free-form respondent
 *   PII: its columns are structural (`sessionId`, `formId`, `formVersion`,
 *   `accessMode`, `status`, `expiresAt`, `createdAt`) — so the scrub set is
 *   empty today. The scrubbed session row is *retained* as an audit shell (it
 *   asserts nothing about the person). Adopters who add PII columns to sessions
 *   must extend the scrub; see `docs/erasure.md`.
 *
 * ## What remains
 *
 * - **The form snapshot** (`form_versions`) — it contains no respondent data,
 *   only the immutable definition and compiled UI (R1).
 * - **`linkId`** on the session, when present — it identifies the *link*, not
 *   the person. Docs warn adopters against distributing links in a way that
 *   embeds PII in the link identity itself.
 * - **The scrubbed `sessions` row** — an audit shell recording that a session
 *   against a form version existed, with all respondent-linkable content gone.
 *
 * ## What the tombstone asserts
 *
 * One `erasure_tombstones` row — `(sessionId, formId, formVersion, erasedAt,
 * reason)` — preserves that a response *existed*, and against which form
 * version, **without preserving any of its content**. The reporting view
 * excludes erased sessions by construction (a tombstone anti-join, independent
 * of the hard delete). The tombstone has no foreign key to `sessions`: it is
 * independent of the session row and survives even if retention later purges
 * that scrubbed shell.
 *
 * ## What erasure does NOT cover (documented, not solved — see docs/erasure.md)
 *
 * - Webhook consumers are **independent data controllers**; erasure does not
 *   propagate downstream (ADR-17).
 * - Postgres physical backups / WAL / replicas age out per the adopter's own
 *   backup-retention policy; crypto-shredding was rejected for launch (ADR-17).
 */

/** A request to erase one session. `reason` is a non-empty operator-supplied note. */
export const EraseRequest = z.object({
  sessionId: SessionId,
  reason: z.string().min(1),
});
export type EraseRequest = z.infer<typeof EraseRequest>;

/**
 * The result of an erasure — the tombstone that now stands for the session,
 * plus `alreadyErased`: `false` when this call performed the deletion, `true`
 * when the session was already erased and the existing tombstone was returned
 * unchanged (idempotency).
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
 * Why an erasure could not be performed. Only one failure mode is expected:
 * the target session does not exist (and has no tombstone either). Execution
 * surfaces it as a typed throw (`@qcms/db`'s `SessionNotFoundError`), whose
 * `code` is one of these.
 */
export const EraseErrorCode = z.enum(["SESSION_NOT_FOUND"]);
export type EraseErrorCode = z.infer<typeof EraseErrorCode>;
