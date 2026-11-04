/** Keep canonical answer values unknown until rendering; the BFF must not coerce or reinterpret frozen encodings. */

export type AccessMode = "anonymous" | "secure_link";

export interface ResponseListItem {
  readonly sessionId: string;
  readonly formVersion: number;
  readonly submittedAt: string;
  readonly accessMode: AccessMode;

  readonly flaggedReason: string | null;
  readonly answers: Readonly<Record<string, unknown>>;
}

export interface ResponsePage {
  readonly responses: readonly ResponseListItem[];
  /** Every version this form's responses carry, newest first, whatever this page holds. */
  readonly formVersions: readonly number[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** Retraction means the respondent cleared an answer; value null must not read as an empty submitted answer. */
export interface LedgerEntry {
  readonly questionId: string;
  readonly value: unknown;
  readonly retracted: boolean;
  readonly answeredAt: string;
}

export interface ResponseDetail {
  readonly sessionId: string;
  readonly formId: string;
  readonly formVersion: number;
  readonly submittedAt: string;
  readonly accessMode: AccessMode;
  readonly flaggedReason: string | null;

  readonly contentHash: string;
  readonly answers: Readonly<Record<string, unknown>>;

  readonly ledger: readonly LedgerEntry[];
}

/** Tombstones retain compliance metadata only, never respondent content. */
export interface Tombstone {
  readonly sessionId: string;
  readonly formId: string;
  readonly formVersion: number;
  readonly erasedAt: string;
  readonly reason: string;
}

export interface EraseOutcome extends Tombstone {
  readonly alreadyErased: boolean;
}

/** This is a navigation offer to another deliberate erasure, never an automatic pending action. */
export interface ErasureElsewhere {
  readonly environment: string;

  readonly alreadyErased: boolean;
}

/** The API already narrows offers to erasable environments; the BFF must not infer hidden results from an empty list. */
export interface ErasureScope {
  readonly sessionId: string;
  readonly environment: string;
  readonly alreadyErased: boolean;
  readonly otherEnvironments: readonly ErasureElsewhere[];
}

/** Webhook reads never contain the signing secret. */
export interface WebhookSummary {
  readonly webhookId: string;
  readonly url: string;
  readonly active: boolean;
  readonly deactivatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Only create and rotate reveal plaintext secrets; never log, cache, revalidate or echo them. */
export interface RevealedWebhook {
  readonly webhookId: string;
  readonly url: string;
  readonly active: boolean;
  readonly secret: string;
}

/** The API masks viewer URLs before transport. Production changes under the two-person rule are proposals, never applied configuration. */
export interface EndpointProposal {
  readonly proposalId: string;
  readonly webhookId: string;
  readonly environment: string;

  readonly kind: "create" | "update" | "deactivate";

  readonly url: string | null;
  readonly active: boolean | null;

  readonly rotatesSecret: boolean;
  readonly proposedBy: string;
  readonly proposedAt: string;
  /** Confirmation and endpoint application use separate pools; confirmed without appliedAt is not live. */
  readonly confirmedBy: string | null;
  readonly confirmedAt: string | null;
  readonly appliedAt: string | null;
}

/** Cancelled deliveries remain visible for audit but must never be attempted or redelivered. */
export type DeliveryStatus = "delivered" | "cancelled" | "deadLettered" | "pending";

/** attempts counts failures, so first-attempt success is zero. Signature headers are masked before storage, not merely hidden in this screen. */
export interface DeliveryItem {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly webhookId: string;
  readonly url: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly deadLetteredAt: string | null;

  readonly cancelledAt: string | null;

  readonly cancelledReason: string | null;
  readonly nextAttemptAt: string;
  readonly lastAttemptAt: string | null;

  readonly lastStatus: number | null;
  readonly latencyMs: number | null;
  readonly requestHeaders: Readonly<Record<string, string>> | null;
  readonly responseSnippet: string | null;
  /** Removed snippets and genuinely absent bodies are distinct; this timestamp records removal by erasure or retention. */
  readonly responseSnippetRedactedAt: string | null;
}

export interface DeadLetterItem {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly webhookId: string;
  /** Keep formId on cross-form queue rows because redelivery is scoped to a form. */
  readonly formId: string;
  readonly url: string;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly deadLetteredAt: string | null;
  readonly createdAt: string;
}
