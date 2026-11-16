"use client";

import { useAppLocale } from "@/components/locale-context";
import { t, type MessageKey } from "@/lib/i18n/en";
import { describeChange, describeKept, type AccessDelta } from "@/lib/membership/access-patterns";

export interface ApprovalNeed {
  /** Why the act waits, in the screen's own words. */
  readonly reason: string;
  /** Who can approve, when the screen can name them. */
  readonly approvers?: string;
}

/** Who gains, loses and keeps what, and whether the act waits for an Approver. */
export function AccessPreview({
  delta,
  approval,
}: {
  readonly delta: AccessDelta;
  readonly approval?: ApprovalNeed | undefined;
}) {
  const locale = useAppLocale();
  const empty = delta.gains.length + delta.losses.length + delta.keeps.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="qcms-access-preview">
      {empty && <p className="text-sm">{t("access.preview.noChange")}</p>}
      <Part
        label="access.preview.gains"
        lines={delta.gains.map((change) => describeChange(change, locale))}
      />
      <Part
        label="access.preview.loses"
        lines={delta.losses.map((change) => describeChange(change, locale))}
      />
      <Part
        label="access.preview.keeps"
        lines={delta.keeps.map((kept) => describeKept(kept, locale))}
      />
      {approval !== undefined && (
        <div className="flex flex-wrap items-center gap-2" data-testid="qcms-access-approval">
          <span className="qcms-tag qcms-tag--deprecated">{t("access.preview.needsApprover")}</span>
          <span className="text-sm">{approval.reason}</span>
          {approval.approvers !== undefined && (
            <span className="text-sm text-(--color-text-muted)">
              {t("access.preview.approvers", { approvers: approval.approvers })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Part({ label, lines }: { readonly label: MessageKey; readonly lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-(--radius-card) border border-(--color-border) px-4 py-3">
      <p className="text-xs font-semibold tracking-wide text-(--color-text-muted) uppercase">
        {t(label)}
      </p>
      <ul className="text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
