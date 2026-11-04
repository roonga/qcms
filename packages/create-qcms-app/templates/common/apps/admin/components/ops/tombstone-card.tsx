"use client";

import { useEffect } from "react";

import { erasureReasonText } from "@/components/ops/ops-tags";
import { claimPostActionFocus, TOMBSTONE_HEADING_ID } from "@/lib/ops/post-action-focus";
import type { Tombstone } from "@/lib/ops/types";
import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";

/* Keep tombstones at the original response URL as existence without answer content, rather than replacing
   evidence with 404. */
export function TombstoneCard({ tombstone }: { readonly tombstone: Tombstone }) {
  // Take focus only after an explicit erase request for this session; an ordinary tombstone visit must not
  // steal it.
  const { sessionId } = tombstone;
  useEffect(() => claimPostActionFocus(TOMBSTONE_HEADING_ID, sessionId), [sessionId]);

  return (
    <section
      aria-labelledby="qcms-tombstone-heading"
      className="qcms-tombstone"
      data-testid="qcms-tombstone"
    >
      <h2
        id={TOMBSTONE_HEADING_ID}
        tabIndex={-1}
        className="text-base font-semibold text-(--color-text)"
      >
        {t("ops.tombstone.title")}
      </h2>
      <p className="text-sm text-(--color-text-muted)">{t("ops.tombstone.body")}</p>
      <dl className="qcms-ops-summary">
        <dt>{t("ops.tombstone.sessionId")}</dt>
        <dd>
          <code className="qcms-link-id">{tombstone.sessionId}</code>
        </dd>
        <dt>{t("ops.tombstone.formVersion")}</dt>
        <dd>v{tombstone.formVersion}</dd>
        <dt>{t("ops.tombstone.erasedAt")}</dt>
        <dd>
          <OperatorDateTime iso={tombstone.erasedAt} fallback={t("ops.common.none")} />
        </dd>
        <dt>{t("ops.tombstone.reason")}</dt>
        <dd data-testid="qcms-tombstone-reason">{erasureReasonText(tombstone.reason)}</dd>
      </dl>
    </section>
  );
}
