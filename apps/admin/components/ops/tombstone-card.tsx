import { erasureReasonText } from "@/components/ops/ops-tags";
import type { Tombstone } from "@/lib/ops/types";
import { formatDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/en";

/**
 * What remains of an erased response (task 035, ADR-17; wireframe "detail erased
 * (tombstone)").
 *
 * Its own module, and a server component, because it is rendered from two places for
 * two different reasons. The detail screen swaps to it the moment an erasure returns,
 * so the operator sees the outcome where they performed it. And the detail **route**
 * renders it on any later visit, because the response is gone and a 404 would be a
 * worse answer than the truth: the URL an operator has in a ticket or an email should
 * keep saying "this was erased, here is the record", not "no such thing".
 *
 * The card holds no answers. That is not a redaction, it is the whole content of a
 * tombstone: existence without content is exactly what ADR-17 keeps.
 */
export function TombstoneCard({ tombstone }: { readonly tombstone: Tombstone }) {
  return (
    <section
      aria-labelledby="qcms-tombstone-heading"
      className="qcms-tombstone"
      data-testid="qcms-tombstone"
    >
      <h3 id="qcms-tombstone-heading" className="text-base font-semibold text-(--color-text)">
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
