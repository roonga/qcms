"use client";

import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { cancelledReasonText, DeliveryStatusTag } from "@/components/ops/ops-tags";
import { OperatorDateTime, useOperatorDateTimeFormat } from "@/components/operator-time";
import type { ReadState } from "@/lib/read-state";
import type { DeliveryItem } from "@/lib/ops/types";
import { formatUtcDateTimeForTests } from "@/lib/i18n/format";
import { t, tPlural } from "@/lib/i18n/en";

export function DeliveryDashboard({
  deliveries,
}: {
  readonly deliveries: ReadState<readonly DeliveryItem[]>;
}) {
  const rows = deliveries.ok ? deliveries.data : undefined;

  const [open, setOpen] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="qcms-deliveries-heading"
      className="flex flex-col gap-3"
      data-testid="qcms-delivery-dashboard"
    >
      <div className="flex flex-col gap-1">
        <h2 id="qcms-deliveries-heading" className="text-lg font-semibold text-(--color-text)">
          {t("ops.deliveries.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("ops.deliveries.intro")}</p>
      </div>

      {rows !== undefined &&
        (rows.length === 0 ? (
          <EmptyState
            heading={t("ops.deliveries.emptyTitle")}
            body={t("ops.deliveries.empty")}
            testId="qcms-deliveries-empty"
          />
        ) : (
          <div className="qcms-table">
            <table data-testid="qcms-deliveries-table">
              <caption className="qcms-visually-hidden">{t("ops.deliveries.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("ops.deliveries.column.event")}</th>
                  <th scope="col">{t("ops.deliveries.column.target")}</th>
                  <th scope="col">{t("ops.deliveries.column.status")}</th>
                  <th
                    scope="col"
                    className="qcms-cell--num"
                    title={t("ops.deliveries.attemptsHint")}
                  >
                    {t("ops.deliveries.column.attempts")}
                  </th>
                  <th scope="col" className="qcms-cell--num qcms-cell--drop">
                    {t("ops.deliveries.column.latency")}
                  </th>
                  <th scope="col" className="qcms-cell--num">
                    {t("ops.deliveries.column.lastAttempt")}
                  </th>
                  <th scope="col">
                    <span className="qcms-visually-hidden">
                      {t("ops.deliveries.column.status")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isOpen = open === row.deliveryId;
                  const panelId = `qcms-delivery-detail-${row.deliveryId}`;
                  return (
                    <DeliveryRows
                      key={row.deliveryId}
                      row={row}
                      isOpen={isOpen}
                      panelId={panelId}
                      onToggle={() => {
                        setOpen(isOpen ? null : row.deliveryId);
                      }}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

/* Distinguish removed response bodies from empty or absent ones; consumer bodies can echo answers and be
   purged on erasure or retention. */
function latencyText(latencyMs: number | null): string {
  return latencyMs === null ? t("ops.common.none") : t("ops.deliveries.latency", { ms: latencyMs });
}

function deliveryDigest(row: DeliveryItem): string {
  const status = t(`ops.deliveries.status.${row.status}`);
  const attempts = tPlural(
    "ops.deliveries.digest.attemptOne",
    "ops.deliveries.digest.attemptOther",
    row.attempts,
  );
  if (row.latencyMs === null) return t("ops.deliveries.digest", { status, attempts });
  return t("ops.deliveries.digest.withLatency", {
    status,
    attempts,
    latency: latencyText(row.latencyMs),
  });
}

function responseBodyText(
  row: DeliveryItem,
  formatWhen: (
    iso: string | null | undefined,
    fallback?: string,
  ) => string = formatUtcDateTimeForTests,
): string {
  if (row.responseSnippetRedactedAt !== null) {
    return t("ops.deliveries.redactedBody", {
      when: formatWhen(row.responseSnippetRedactedAt, t("ops.common.none")),
    });
  }
  if (row.responseSnippet === null || row.responseSnippet === "") {
    return t("ops.deliveries.emptyBody");
  }
  return row.responseSnippet;
}

export function DeliveryRows({
  row,
  isOpen,
  panelId,
  onToggle,
}: {
  readonly row: DeliveryItem;
  readonly isOpen: boolean;
  readonly panelId: string;
  readonly onToggle: () => void;
}) {
  const formatWhen = useOperatorDateTimeFormat();
  return (
    <>
      <tr data-delivery-id={row.deliveryId} data-status={row.status}>
        <th scope="row">
          <code className="qcms-link-id">{row.eventType}</code>
        </th>
        <td>
          <span className="qcms-link-url">{row.url}</span>
        </td>
        <td>
          <DeliveryStatusTag status={row.status} />
        </td>
        <td className="qcms-cell--num" data-testid="qcms-delivery-attempts">
          {row.attempts}
        </td>
        <td className="qcms-cell--num qcms-cell--drop">{latencyText(row.latencyMs)}</td>
        <td className="qcms-cell--num">
          <OperatorDateTime iso={row.lastAttemptAt} fallback={t("ops.common.none")} />
        </td>
        <td>
          <button
            type="button"
            className="qcms-text-link"
            aria-expanded={isOpen}
            // Set aria-controls only while its target panel exists; a closed disclosure cannot reference an unmounted
            // id.
            aria-controls={isOpen ? panelId : undefined}
            onClick={onToggle}
          >
            {t(isOpen ? "ops.deliveries.hideDetail" : "ops.deliveries.showDetail", {
              event: row.eventType,
            })}
            <span
              className="block text-xs font-normal text-(--color-text-muted)"
              data-testid="qcms-delivery-digest"
            >
              {deliveryDigest(row)}
            </span>
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7}>
            <div id={panelId} className="flex flex-col gap-2" data-testid="qcms-delivery-detail">
              {row.cancelledAt !== null && (
                <p className="text-sm text-(--color-text)" data-testid="qcms-delivery-cancelled">
                  {cancelledReasonText(row.cancelledReason)} {t("ops.deliveries.cancelledAt")}:{" "}
                  <OperatorDateTime iso={row.cancelledAt} fallback={t("ops.common.none")} />
                </p>
              )}
              {/* Repeat every digest fact inside the disclosure, including latency hidden from compact table columns. */}
              <h3 className="text-sm font-semibold text-(--color-text)">
                {t("ops.deliveries.attemptSummary")}
              </h3>
              <dl className="qcms-ops-summary" data-testid="qcms-delivery-facts">
                <dt>{t("ops.deliveries.column.status")}</dt>
                <dd data-testid="qcms-delivery-fact-status">
                  {t(`ops.deliveries.status.${row.status}`)}
                </dd>
                <dt>{t("ops.deliveries.column.attempts")}</dt>
                <dd data-testid="qcms-delivery-fact-attempts">{row.attempts}</dd>
                <dt>{t("ops.deliveries.column.latency")}</dt>
                <dd data-testid="qcms-delivery-fact-latency">{latencyText(row.latencyMs)}</dd>
              </dl>
              {row.lastAttemptAt === null ? (
                <p className="text-sm text-(--color-text-muted)">{t("ops.deliveries.noAttempt")}</p>
              ) : (
                <>
                  <h4 className="text-sm font-semibold text-(--color-text)">
                    {t("ops.deliveries.requestHeaders")}
                  </h4>
                  <p className="text-sm text-(--color-text-muted)">
                    {t("ops.deliveries.signatureMasked")}
                  </p>
                  <dl className="qcms-ops-summary" data-testid="qcms-delivery-headers">
                    {Object.entries(row.requestHeaders ?? {}).map(([name, value]) => (
                      <RequestHeader key={name} name={name} value={value} />
                    ))}
                  </dl>
                  {row.lastStatus === null ? (
                    <p
                      className="text-sm text-(--color-text)"
                      data-testid="qcms-delivery-no-response"
                    >
                      {t("ops.deliveries.noResponse", {
                        error: row.lastError ?? t("ops.common.none"),
                      })}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-(--color-text)">
                        {t("ops.deliveries.responseCode")}:{" "}
                        <span data-testid="qcms-delivery-response-code">{row.lastStatus}</span>
                      </p>
                      <h4 className="text-sm font-semibold text-(--color-text)">
                        {t("ops.deliveries.responseBody")}
                      </h4>
                      {/* Make the capped scroll region focusable so keyboard users can reach the whole consumer response. */}
                      <pre
                        className="qcms-snippet"
                        tabIndex={0}
                        role="region"
                        aria-label={t("ops.deliveries.responseBody")}
                        data-testid="qcms-delivery-response-body"
                      >
                        {responseBodyText(row, formatWhen)}
                      </pre>
                    </>
                  )}
                  {row.lastError !== null && row.lastStatus !== null && (
                    <p className="text-sm text-(--color-text)">
                      {t("ops.deliveries.lastError")}: <code>{row.lastError}</code>
                    </p>
                  )}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RequestHeader({ name, value }: { readonly name: string; readonly value: string }) {
  return (
    <>
      <dt data-header-name={name}>
        <code>{name}</code>
      </dt>
      <dd>
        <code className="qcms-link-url">{value}</code>
      </dd>
    </>
  );
}
