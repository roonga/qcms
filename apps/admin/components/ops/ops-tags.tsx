import { isErasureReason } from "@/lib/ops/erasure";
import type { DeliveryStatus } from "@/lib/ops/types";
import { t } from "@/lib/i18n/en";

export function DeliveryStatusTag({ status }: { readonly status: DeliveryStatus }) {
  return (
    <span className={`qcms-tag qcms-tag--delivery-${status}`} data-delivery-status={status}>
      {t(`ops.deliveries.status.${status}`)}
    </span>
  );
}

export function FlagTag({ flagged }: { readonly flagged: boolean }) {
  const key = flagged ? "flagged" : "clean";
  return (
    <span className={`qcms-tag qcms-tag--flag-${key}`} data-flagged={flagged ? "true" : "false"}>
      {t(`ops.responses.flag.${key}`)}
    </span>
  );
}

/* The database column is free text despite the closed vocabulary; quote unknown values rather than
   presenting them as localized prose. */
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

export function erasureReasonText(reason: string): string {
  return isErasureReason(reason)
    ? t(`ops.erase.reason.${reason}`)
    : t("ops.erase.reason.unknown", { reason });
}

export function cancelledReasonText(reason: string | null): string {
  if (reason === "session_erased") return t("ops.deliveries.cancelled.session_erased");
  return t("ops.deliveries.cancelled.unknown", { reason: reason ?? "" });
}
