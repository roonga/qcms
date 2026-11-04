import type {
  DeadLetterItem,
  DeliveryItem,
  DeliveryStatus,
  EndpointProposal,
  RevealedWebhook,
  WebhookSummary,
} from "../ops/types.ts";

import { proposalHeaders, type AgentProposalRef } from "./agent-proposal.ts";
import { adminApiFetch } from "./api.ts";
import type { AdminApiPath } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** Plaintext secrets exist only in create/rotate results: pass them straight to the reveal UI, never logs, caches or errors. Bulk redelivery calls the per-delivery API and reports each outcome. */

export async function listWebhooks(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<readonly WebhookSummary[]>> {
  const result = await readResult<{ webhooks?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/webhooks`),
  );
  if (!result.ok) return result;
  return { ok: true, data: rows(result.data.webhooks).filter(isWebhook).map(parseWebhook) };
}

/** Pending production changes reveal the secret once now, but nothing signs with it until a second account confirms. */
export async function createWebhook(
  session: AdminSession,
  formId: string,
  request: { readonly url: string; readonly active: boolean },
  proposal?: AgentProposalRef,
): Promise<ApiResult<ConfigureOutcome<RevealedWebhook>>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/webhooks`, {
      method: "POST",
      body: request,
      headers: proposalHeaders(proposal),
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: outcome(result.data, () => parseRevealed(result.data)) };
}

/** Rotation immediately invalidates old-secret verification on the next signed delivery; confirmation must state that consequence. */
export async function rotateWebhookSecret(
  session: AdminSession,
  formId: string,
  webhookId: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<ConfigureOutcome<RevealedWebhook>>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "PUT", body: { rotateSecret: true }, headers: proposalHeaders(proposal) },
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: outcome(result.data, () => parseRevealed({ ...result.data, webhookId })),
  };
}

/** Deactivation preserves history and permits reactivation. Already-materialized deliveries retain their own retry state. */
export async function deactivateWebhook(
  session: AdminSession,
  formId: string,
  webhookId: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<ConfigureOutcome<{ readonly webhookId: string }>>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "DELETE", headers: proposalHeaders(proposal) },
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: outcome(result.data, () => ({ webhookId: text(result.data["webhookId"], webhookId) })),
  };
}

export async function reactivateWebhook(
  session: AdminSession,
  formId: string,
  webhookId: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<ConfigureOutcome<{ readonly webhookId: string }>>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "PUT", body: { active: true }, headers: proposalHeaders(proposal) },
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: outcome(result.data, () => ({ webhookId: text(result.data["webhookId"], webhookId) })),
  };
}

export async function retargetWebhook(
  session: AdminSession,
  formId: string,
  webhookId: string,
  url: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<ConfigureOutcome<{ readonly webhookId: string; readonly url: string }>>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "PUT", body: { url }, headers: proposalHeaders(proposal) },
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: outcome(result.data, () => ({
      webhookId: text(result.data["webhookId"], webhookId),
      url: text(result.data["url"], url),
    })),
  };
}

export async function listDeliveries(
  session: AdminSession,
  formId: string,
  limit?: number,
): Promise<ApiResult<readonly DeliveryItem[]>> {
  const path: AdminApiPath = `/forms/${encodeURIComponent(formId)}/deliveries${
    limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`
  }`;
  const result = await readResult<{ deliveries?: unknown }>(await adminApiFetch(session, path));
  if (!result.ok) return result;
  return {
    ok: true,
    data: rows(result.data.deliveries)
      .filter((entry) => typeof entry["deliveryId"] === "string")
      .map(parseDelivery),
  };
}

/** Dead letters span forms; each row must retain formId for scoped redelivery. */
export async function listDeadLetters(
  session: AdminSession,
): Promise<ApiResult<readonly DeadLetterItem[]>> {
  const result = await readResult<{ deadLetters?: unknown }>(
    await adminApiFetch(session, "/outbox/dead-letters"),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: rows(result.data.deadLetters)
      .filter((entry) => typeof entry["deliveryId"] === "string")
      .map((entry) => ({
        deliveryId: entry["deliveryId"] as string,
        eventId: text(entry["eventId"], ""),
        eventType: text(entry["eventType"], ""),
        webhookId: text(entry["webhookId"], ""),

        formId: text(entry["formId"], ""),
        url: text(entry["url"], ""),
        attempts: count(entry["attempts"], 0),
        lastError: nullableText(entry["lastError"]),
        deadLetteredAt: nullableText(entry["deadLetteredAt"]),
        createdAt: text(entry["createdAt"], ""),
      })),
  };
}

/** Redelivery is form-scoped; a delivery ID alone cannot establish the target form. */
export async function redeliver(
  session: AdminSession,
  formId: string,
  deliveryId: string,

  environment: string,
  proposal?: AgentProposalRef,
): Promise<ApiResult<{ readonly deliveryId: string; readonly nextAttemptAt: string }>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
      { method: "POST", environment, headers: proposalHeaders(proposal) },
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      deliveryId: text(result.data["deliveryId"], deliveryId),
      nextAttemptAt: text(result.data["nextAttemptAt"], ""),
    },
  };
}

export async function listEndpointProposals(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<readonly EndpointProposal[]>> {
  const result = await readResult<{ proposals?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/webhooks/proposals`),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: rows(result.data.proposals)
      .filter((entry) => typeof entry["proposalId"] === "string")
      .map(parseProposal),
  };
}

/** The API refuses self-approval and requires environment-scoped approver grants; the BFF only renders the result. */
export async function confirmEndpointProposal(
  session: AdminSession,
  formId: string,
  proposalId: string,
  environment: string,
): Promise<ApiResult<EndpointProposal>> {
  const result = await readResult<{ proposal?: unknown }>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/proposals/${encodeURIComponent(proposalId)}/confirm`,
      { method: "POST", environment },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseProposal(asRecord(result.data.proposal)) };
}

export async function withdrawEndpointProposal(
  session: AdminSession,
  formId: string,
  proposalId: string,
  environment: string,
): Promise<ApiResult<EndpointProposal>> {
  const result = await readResult<{ proposal?: unknown }>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/proposals/${encodeURIComponent(proposalId)}`,
      { method: "DELETE", environment },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseProposal(asRecord(result.data.proposal)) };
}

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}

const PROPOSAL_KINDS: readonly EndpointProposal["kind"][] = ["create", "update", "deactivate"];

/** Unknown changes must stay visible and withdrawable. Null URL means no target, as on deactivation, rather than a target set to empty text. */
function parseProposal(entry: Record<string, unknown>): EndpointProposal {
  return {
    proposalId: text(entry["proposalId"], ""),
    webhookId: text(entry["webhookId"], ""),
    environment: text(entry["environment"], ""),
    kind: PROPOSAL_KINDS.find((kind) => kind === entry["kind"]) ?? "update",
    url: nullableText(entry["url"]),
    active: typeof entry["active"] === "boolean" ? entry["active"] : null,
    rotatesSecret: entry["rotatesSecret"] === true,
    proposedBy: text(entry["proposedBy"], ""),
    proposedAt: text(entry["proposedAt"], ""),
    confirmedBy: nullableText(entry["confirmedBy"]),
    confirmedAt: nullableText(entry["confirmedAt"]),
    appliedAt: nullableText(entry["appliedAt"]),
  };
}

/** A pending body means no endpoint change has applied; read the marker for every mutation rather than assuming success from status alone. */
function pendingOf(entry: Record<string, unknown>): EndpointProposal | undefined {
  if (entry["pending"] !== true) return undefined;
  return parseProposal(asRecord(entry["proposal"]));
}

const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "delivered",
  "cancelled",
  "deadLettered",
  "pending",
];

function text(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw !== "" ? raw : fallback;
}

function nullableText(raw: unknown): string | null {
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function count(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function nullableCount(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function rows(raw: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}

function isWebhook(entry: Record<string, unknown>): boolean {
  return typeof entry["webhookId"] === "string";
}

function parseWebhook(entry: Record<string, unknown>): WebhookSummary {
  return {
    webhookId: entry["webhookId"] as string,
    url: text(entry["url"], ""),
    active: entry["active"] === true,
    deactivatedAt: nullableText(entry["deactivatedAt"]),
    createdAt: text(entry["createdAt"], ""),
    updatedAt: text(entry["updatedAt"], ""),
  };
}

/** Missing secret is a contract failure shown as recoverable copy, never an empty reveal or a crashed screen. */
function parseRevealed(entry: Record<string, unknown>): RevealedWebhook {
  return {
    webhookId: text(entry["webhookId"], ""),
    url: text(entry["url"], ""),
    active: entry["active"] !== false,
    secret: typeof entry["secret"] === "string" ? entry["secret"] : "",
  };
}

/** Unknown deliveries remain visible and actionable as pending; filtering them out would hide work that may need redelivery. */
function parseDelivery(entry: Record<string, unknown>): DeliveryItem {
  return {
    deliveryId: entry["deliveryId"] as string,
    eventId: text(entry["eventId"], ""),
    eventType: text(entry["eventType"], ""),
    webhookId: text(entry["webhookId"], ""),
    url: text(entry["url"], ""),
    status: DELIVERY_STATUSES.find((status) => status === entry["status"]) ?? "pending",
    attempts: count(entry["attempts"], 0),
    lastError: nullableText(entry["lastError"]),
    createdAt: text(entry["createdAt"], ""),
    deliveredAt: nullableText(entry["deliveredAt"]),
    deadLetteredAt: nullableText(entry["deadLetteredAt"]),
    cancelledAt: nullableText(entry["cancelledAt"]),
    cancelledReason: nullableText(entry["cancelledReason"]),
    nextAttemptAt: text(entry["nextAttemptAt"], ""),
    lastAttemptAt: nullableText(entry["lastAttemptAt"]),
    lastStatus: nullableCount(entry["lastStatus"]),
    latencyMs: nullableCount(entry["latencyMs"]),
    requestHeaders: headerMap(entry["requestHeaders"]),
    responseSnippet: nullableText(entry["responseSnippet"]),
    responseSnippetRedactedAt: nullableText(entry["responseSnippetRedactedAt"]),
  };
}

function headerMap(raw: unknown): Readonly<Record<string, string>> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length === 0 ? null : Object.fromEntries(entries);
}

/** Every configuration mutation must distinguish applied from pending so the UI cannot claim an unapproved production change occurred. */
export type ConfigureOutcome<T> =
  | { readonly pending: false; readonly applied: T }
  | { readonly pending: true; readonly proposal: EndpointProposal; readonly secret?: string };

function outcome<T>(entry: Record<string, unknown>, applied: () => T): ConfigureOutcome<T> {
  const proposal = pendingOf(entry);
  if (proposal === undefined) return { pending: false, applied: applied() };
  return {
    pending: true,
    proposal,
    /** Present only when the pending change sets a new signing secret, and shown exactly once here as it would have been on a change that applied at once (SEC-6). */
    ...(typeof entry["secret"] === "string" ? { secret: entry["secret"] } : {}),
  };
}
