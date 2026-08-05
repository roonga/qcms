/**
 * The shapes the operations screens read (task 035): responses, erasure, webhook
 * config, and webhook delivery.
 *
 * Every one of them is what the **API** returns, re-declared here rather than
 * imported, for the reason `lib/forms/types.ts` gives: the admin is a strict BFF
 * (R2) and does not share a package with the API, so these are the contract as this
 * app reads it. The proxies in `lib/server/` parse an `unknown` payload into
 * exactly these and nothing wider.
 *
 * Answer values stay `unknown` all the way to the renderer. They are canonical
 * encodings the reporting view froze (015) - a string, a number, a boolean, or an
 * array of option ids - and this app has no business narrowing them: it has no
 * `@qcms/core` value import at all (`r2-import-surface.test.ts`).
 */

/** How the respondent reached the form. */
export type AccessMode = "anonymous" | "secure_link";

/** One row of `GET /admin/forms/{id}/responses`. */
export interface ResponseListItem {
  readonly sessionId: string;
  readonly formVersion: number;
  readonly submittedAt: string;
  readonly accessMode: AccessMode;
  /** `null` = clean; a reason string = flagged, and its webhook event is withheld. */
  readonly flaggedReason: string | null;
  readonly answers: Readonly<Record<string, unknown>>;
}

/** A page of responses, with the paging the list route reports. */
export interface ResponsePage {
  readonly responses: readonly ResponseListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/**
 * One revision in the append-only answer ledger.
 *
 * `retracted` is the discriminator and is always present: a retraction (ADR-33)
 * carries `value: null` and `retracted: true` and means the respondent CLEARED the
 * question at that point in the history. The timeline must say so rather than
 * rendering an empty value, which would read as "answered with nothing".
 */
export interface LedgerEntry {
  readonly questionId: string;
  readonly value: unknown;
  readonly retracted: boolean;
  readonly answeredAt: string;
}

/** `GET /admin/forms/{id}/responses/{sessionId}` - the locked set plus its audit history. */
export interface ResponseDetail {
  readonly sessionId: string;
  readonly formId: string;
  readonly formVersion: number;
  readonly submittedAt: string;
  readonly accessMode: AccessMode;
  readonly flaggedReason: string | null;
  /** The audit anchor (009): any holder can re-derive and verify the locked set. */
  readonly contentHash: string;
  readonly answers: Readonly<Record<string, unknown>>;
  /** Oldest first: the order the respondent actually answered in. */
  readonly ledger: readonly LedgerEntry[];
}

/**
 * An erasure tombstone (ADR-17): the record that a session existed and was erased.
 *
 * It is what remains after erasure and it is deliberately content-free - session id,
 * form, version, when, and why. The response is gone; the fact of it is not, which
 * is what makes the erasure log usable as compliance evidence.
 */
export interface Tombstone {
  readonly sessionId: string;
  readonly formId: string;
  readonly formVersion: number;
  readonly erasedAt: string;
  readonly reason: string;
}

/** `POST /admin/sessions/{sessionId}/erase` - the tombstone, and whether this call made it. */
export interface EraseOutcome extends Tombstone {
  /** `true` when the session was already erased, so this call changed nothing. */
  readonly alreadyErased: boolean;
}

/** One configured webhook. The secret is never in a read. */
export interface WebhookSummary {
  readonly webhookId: string;
  readonly url: string;
  readonly active: boolean;
  readonly deactivatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A webhook whose secret is on screen for the only time it ever will be.
 *
 * Returned by create and by an explicit rotate, and by nothing else: the API stores
 * ciphertext under `QCMS_APP_KEY` and has no path that decrypts it back to a
 * response (SEC-6). This app therefore never logs it, never caches it, never
 * revalidates it into a payload, and never sends it back up (SEC-13).
 */
export interface RevealedWebhook {
  readonly webhookId: string;
  readonly url: string;
  readonly active: boolean;
  readonly secret: string;
}

/** The delivery lifecycle, as the API derives it from the row's timestamps. */
export type DeliveryStatus = "delivered" | "deadLettered" | "pending";

/**
 * One row of `GET /admin/forms/{id}/deliveries`.
 *
 * `attempts` counts **failed** attempts, which is what the retry schedule reads it
 * as, so a first-time success is `0`. The column is labelled accordingly; see
 * `markDeliveryDelivered` in `@qcms/db` for why the counter was not redefined.
 *
 * `requestHeaders` arrives with `x-qcms-signature` already masked - the deliverer
 * masks it before storage, so the HMAC is absent from the database rather than
 * hidden by this screen.
 */
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
  readonly nextAttemptAt: string;
  readonly lastAttemptAt: string | null;
  /** Null when the attempt never got a response at all (timeout, network error). */
  readonly lastStatus: number | null;
  readonly latencyMs: number | null;
  readonly requestHeaders: Readonly<Record<string, string>> | null;
  readonly responseSnippet: string | null;
}

/** One row of `GET /admin/outbox/dead-letters` - the queue, across every form. */
export interface DeadLetterItem {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly webhookId: string;
  readonly url: string;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly deadLetteredAt: string | null;
  readonly createdAt: string;
}
