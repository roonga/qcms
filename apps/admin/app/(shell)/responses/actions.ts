"use server";

import { revalidatePath } from "next/cache";

import type { ErasureReason } from "@/lib/ops/erasure";
import { isErasureReason } from "@/lib/ops/erasure";
import type { EraseOutcome } from "@/lib/ops/types";
import { eraseSession, unflagResponse } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The response screens' two mutations (task 035).
 *
 * Both are imperative server actions rather than form posts, for 033's reason: they
 * are called from a mounted dialog that has to render the outcome in place, and a
 * redirect-back round trip would throw away the dialog's state (including, for
 * erasure, the fact that the operator had just typed a confirmation).
 *
 * Both take `formId` first so the page can bind it, which means the form whose paths
 * get revalidated comes from the **route** and not from the client. That matters more
 * here than on the builder: a caller cannot aim an erasure's cache invalidation at
 * another form, and the erasure itself is scoped by the session id the API resolves.
 *
 * `requireAdminSession()` is called in each one because a `"use server"` module is
 * reached directly by the browser and is not covered by the shell layout's gate
 * (issue #177, `shell-route-guards.test.ts`).
 */

/** What the erase dialog renders. */
export interface EraseState {
  readonly status: "erased" | "error";
  readonly data?: EraseOutcome;
  readonly message?: string;
}

/** What the unflag dialog renders. */
export interface UnflagState {
  readonly status: "unflagged" | "error";
  readonly released?: boolean;
  readonly message?: string;
}

/**
 * Erase one session's respondent data (ADR-17).
 *
 * The reason is re-checked against the closed vocabulary here rather than trusted
 * from the client: it is written onto a tombstone that outlives the data it
 * describes, so an arbitrary string arriving from a tampered payload must not end up
 * in a compliance record.
 *
 * Every list that could still be holding the erased response is revalidated: the
 * browser, the detail, and the erasure log the tombstone now belongs to.
 */
export async function eraseSessionAction(
  formId: string,
  sessionId: string,
  reason: ErasureReason,
): Promise<EraseState> {
  const session = await requireAdminSession();
  if (!isErasureReason(reason)) {
    return { status: "error", message: "The erasure reason was not one this build records." };
  }
  const result = await eraseSession(session, sessionId, reason);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/forms/${formId}/responses`);
  revalidatePath(`/forms/${formId}/responses/${sessionId}`);
  revalidatePath("/responses/erasures");
  return { status: "erased", data: result.data };
}

/** Release a flagged response's withheld `response.submitted` event (023). */
export async function unflagResponseAction(
  formId: string,
  sessionId: string,
): Promise<UnflagState> {
  const session = await requireAdminSession();
  const result = await unflagResponse(session, sessionId);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/forms/${formId}/responses`);
  revalidatePath(`/forms/${formId}/responses/${sessionId}`);
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "unflagged", released: result.data.released };
}
