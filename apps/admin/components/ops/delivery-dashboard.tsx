"use client";

import { useState } from "react";

import { DeliveryStatusTag } from "@/components/ops/ops-tags";
import type { DeliveryItem } from "@/lib/ops/types";
import { formatDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/en";

/**
 * The delivery dashboard (task 035; wireframe "delivery dashboard").
 *
 * One row per (event, endpoint), each carrying the record of its **most recent
 * attempt** - status, failed-attempt count, latency, and behind a disclosure the
 * request headers and the response. Every one of those is read from what the
 * deliverer wrote on the row when it made the attempt; none of it is reconstructed
 * here from what the deliverer is expected to send. A screen that described the
 * request from the code's intent would keep describing it after the code changed.
 *
 * ## Two labels are worded from the data rather than from the wireframe
 *
 * The attempts column says **failed attempts**, because that is what the column
 * counts: the retry schedule increments it on failure only, so a delivery that
 * succeeded first time is a zero next to a "Delivered" tag. Relabelling was the
 * honest fix; redefining the counter would have changed the backoff's input.
 *
 * The request headers panel says the signature is masked **before it is stored**,
 * which is true of the pipeline and not just of this render: the deliverer replaces
 * the HMAC with `SIGNATURE_MASK` on the way into the database, so the row never held
 * it (SEC-6, SEC-13).
 */
export function DeliveryDashboard({
  deliveries,
}: {
  readonly deliveries: readonly DeliveryItem[];
}) {
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

      {deliveries.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-deliveries-empty">
          {t("ops.deliveries.empty")}
        </p>
      ) : (
        <table className="qcms-ops-table" data-testid="qcms-deliveries-table">
          <caption className="qcms-visually-hidden">{t("ops.deliveries.table")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("ops.deliveries.column.event")}</th>
              <th scope="col">{t("ops.deliveries.column.target")}</th>
              <th scope="col">{t("ops.deliveries.column.status")}</th>
              <th scope="col" title={t("ops.deliveries.attemptsHint")}>
                {t("ops.deliveries.column.attempts")}
              </th>
              <th scope="col">{t("ops.deliveries.column.latency")}</th>
              <th scope="col">{t("ops.deliveries.column.lastAttempt")}</th>
              <th scope="col">
                <span className="qcms-visually-hidden">{t("ops.deliveries.column.status")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((row) => {
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
      )}
    </section>
  );
}

/**
 * One delivery: its summary row, and the disclosure row beneath it.
 *
 * Two `<tr>`s rather than a nested table, so the detail stays inside the same row
 * group and a screen reader reading the table linearly meets the detail immediately
 * after the row it belongs to. The trigger is a real `<button>` with
 * `aria-expanded`/`aria-controls`, which is what makes it a disclosure rather than a
 * div that happens to toggle.
 */
function DeliveryRows({
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
        <td data-testid="qcms-delivery-attempts">{row.attempts}</td>
        <td>
          {row.latencyMs === null
            ? t("ops.common.none")
            : t("ops.deliveries.latency", { ms: row.latencyMs })}
        </td>
        <td>{formatDateTime(row.lastAttemptAt, t("ops.common.none"))}</td>
        <td>
          <button
            type="button"
            className="qcms-text-link"
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={onToggle}
          >
            {t(isOpen ? "ops.deliveries.hideDetail" : "ops.deliveries.showDetail", {
              event: row.eventType,
            })}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7}>
            <div id={panelId} className="flex flex-col gap-2" data-testid="qcms-delivery-detail">
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
                      <pre className="qcms-snippet" data-testid="qcms-delivery-response-body">
                        {row.responseSnippet === null || row.responseSnippet === ""
                          ? t("ops.deliveries.emptyBody")
                          : row.responseSnippet}
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
