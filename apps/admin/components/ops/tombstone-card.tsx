"use client";

import { useEffect } from "react";

import { erasureReasonText } from "@/components/ops/ops-tags";
import { claimPostActionFocus, TOMBSTONE_HEADING_ID } from "@/lib/ops/post-action-focus";
import type { Tombstone } from "@/lib/ops/types";
import { formatDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/en";

/**
 * What remains of an erased response (task 035, ADR-17; wireframe "detail erased
 * (tombstone)").
 *
 * Its own module, because it is rendered from two places for two different reasons.
 * The detail screen swaps to it the moment an erasure returns, so the operator sees the
 * outcome where they performed it. And the detail **route** renders it on any later
 * visit, because the response is gone and a 404 would be a worse answer than the truth:
 * the URL an operator has in a ticket or an email should keep saying "this was erased,
 * here is the record", not "no such thing".
 *
 * Those two places are also why it is a client component (it was a server one until
 * issue #308): an erasure renders it twice, once from the client and once from the
 * route that revalidation re-runs, and only the card itself is in a position to hold
 * focus across that swap.
 *
 * The card holds no answers. That is not a redaction, it is the whole content of a
 * tombstone: existence without content is exactly what ADR-17 keeps.
 */
export function TombstoneCard({ tombstone }: { readonly tombstone: Tombstone }) {
  // A card that arrives because an operator just erased something takes focus; a card
  // that arrives because someone opened the URL does not. The difference is a request
  // left by the erase path, never the mount itself (issue #308, `post-action-focus`).
  useEffect(() => claimPostActionFocus(TOMBSTONE_HEADING_ID), []);

  return (
    <section
      aria-labelledby="qcms-tombstone-heading"
      className="qcms-tombstone"
      data-testid="qcms-tombstone"
    >
      {/* Focusable so the detail screen can put focus here the moment an erasure
          replaces the answers with this card (issue #308). `-1` keeps it out of the tab
          order: it is a destination, not a stop. */}
      <h3
        id={TOMBSTONE_HEADING_ID}
        tabIndex={-1}
        className="text-base font-semibold text-(--color-text)"
      >
        {t("ops.tombstone.title")}
      </h3>
      <p className="text-sm text-(--color-text-muted)">{t("ops.tombstone.body")}</p>
      <dl className="qcms-ops-summary">
        <dt>{t("ops.tombstone.sessionId")}</dt>
        <dd>
          <code className="qcms-link-id">{tombstone.sessionId}</code>
        </dd>
        <dt>{t("ops.tombstone.formVersion")}</dt>
        <dd>v{tombstone.formVersion}</dd>
        <dt>{t("ops.tombstone.erasedAt")}</dt>
        <dd>{formatDateTime(tombstone.erasedAt, t("ops.common.none"))}</dd>
        <dt>{t("ops.tombstone.reason")}</dt>
        <dd data-testid="qcms-tombstone-reason">{erasureReasonText(tombstone.reason)}</dd>
      </dl>
    </section>
  );
}
