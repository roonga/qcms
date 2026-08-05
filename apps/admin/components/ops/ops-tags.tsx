import { isErasureReason } from "@/lib/ops/erasure";
import type { DeliveryStatus } from "@/lib/ops/types";
import { t } from "@/lib/i18n/en";

/**
 * The operations screens' badges (task 035; wireframe "status `tag`", "flagged `tag`").
 *
 * The same shape `LinkStateTag` and `StatusTag` are, and for the same two reasons: the
 * kit has no tag component and this is app chrome rather than a new variant of a
 * vendored control (ADR-22), and **the word is always rendered** so the tint is a
 * secondary signal only. That matters more here than anywhere else in the app: a
 * dead-lettered delivery and a delivered one differ by an outcome an operator has to
 * act on, and "the red one" is not a reading of the screen a colour-blind operator or
 * a high-contrast theme can offer.
 */

/** Delivered / dead-lettered / pending. */
export function DeliveryStatusTag({ status }: { readonly status: DeliveryStatus }) {
  return (
    <span className={`qcms-tag qcms-tag--delivery-${status}`} data-delivery-status={status}>
      {t(`ops.deliveries.status.${status}`)}
    </span>
  );
}

/**
 * Flagged, or not.
 *
 * A clean response gets a badge too rather than an empty cell, because "no badge" is
 * indistinguishable from "the badge failed to render" in a column an operator scans
 * for exceptions.
 */
export function FlagTag({ flagged }: { readonly flagged: boolean }) {
  const key = flagged ? "flagged" : "clean";
  return (
    <span className={`qcms-tag qcms-tag--flag-${key}`} data-flagged={flagged ? "true" : "false"}>
      {t(`ops.responses.flag.${key}`)}
    </span>
  );
}

/**
 * The sentence explaining one flag reason.
 *
 * The vocabulary is closed (`FlagReason` in the API: HONEYPOT, MIN_TIME,
 * RATE_ANOMALY) but the column it is stored in is free text, so a value this build
 * has never heard of is quoted back inside a sentence rather than rendered raw as if
 * it were prose - the same fallback rule `messageForFormCode` uses.
 */
export function flagReasonText(reason: string): string {
  switch (reason) {
    case "HONEYPOT":
      return t("ops.responses.reason.HONEYPOT");
    case "MIN_TIME":
      return t("ops.responses.reason.MIN_TIME");
    case "RATE_ANOMALY":
      return t("ops.responses.reason.RATE_ANOMALY");
    default:
      return t("ops.responses.reason.unknown", { reason });
  }
}

/**
 * The sentence for one recorded erasure reason.
 *
 * Same shape as {@link flagReasonText} and for the same reason: the vocabulary is
 * closed (`ERASURE_REASONS`) but the column it lands in is free text, so a value this
 * build has never heard of is quoted back inside a sentence rather than rendered raw.
 *
 * The tombstone and the erasure log are **compliance evidence**, which is exactly the
 * surface where a machine enum leaking through is worst: `subject_request` is not a
 * reason a person reads, and the erase dialog that recorded it already showed "Data
 * subject request" from this same catalog.
 */
export function erasureReasonText(reason: string): string {
  return isErasureReason(reason)
    ? t(`ops.erase.reason.${reason}`)
    : t("ops.erase.reason.unknown", { reason });
}
