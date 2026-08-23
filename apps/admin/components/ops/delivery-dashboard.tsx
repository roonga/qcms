"use client";

import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { cancelledReasonText, DeliveryStatusTag } from "@/components/ops/ops-tags";
import type { ReadState } from "@/lib/read-state";
import type { DeliveryItem } from "@/lib/ops/types";
import { formatDateTime } from "@/lib/i18n/format";
import { t, tPlural } from "@/lib/i18n/en";

/**
 * The delivery dashboard (task 035; screen contract "delivery dashboard").
 *
 * One row per (event, endpoint), each carrying the record of its **most recent
 * attempt** - status, failed-attempt count, latency, and behind a disclosure the
 * request headers and the response. Every one of those is read from what the
 * deliverer wrote on the row when it made the attempt; none of it is reconstructed
 * here from what the deliverer is expected to send. A screen that described the
 * request from the code's intent would keep describing it after the code changed.
 *
 * ## Two labels are worded from the data rather than from the screen contract
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
 *
 * ## The row trigger carries a digest, and the panel carries the same three facts
 *
 * Issue 519, `plan/admin-ux-audit.md` §3.8: the disclosure mechanism here was already
 * the right one, and what it lacked was a statement of what is behind it. The trigger
 * now reads "Show request and response for X. Dead-lettered, 4 failed attempts, 1240 ms".
 *
 * §3.7's rule applies to that trigger even though this disclosure is a button and not a
 * `<details>`: a digest may never be the only place a fact lives. Two of the three are in
 * always-present row cells, but **latency is not** - it carries `qcms-cell--drop`, which
 * is `display: none` below 40rem, so below that width the digest would have been the
 * single copy of it. The `This delivery` list inside the panel is where all three now
 * live in full, at every width, and it is what the §3.7 test asserts against.
 *
 * That list's `h3` also closes the heading-order gap this panel carried (**issue #541**):
 * the request-headers heading was an `h4` sitting directly under the dashboard's `h2`,
 * so the panel skipped a level. It is now h2 dashboard, h3 this delivery, h4 request
 * headers, and the `KNOWN_HEADING_ORDER_GAPS` entry that registered the skip is deleted
 * from `apps/admin/e2e/a11y-axe.pw.ts`.
 *
 * ## A failed read is not a form nothing has been delivered for (issues 572, 544)
 *
 * `deliveries` is a `ReadState` (`lib/read-state.ts`), not an array. It used to be handed
 * `ok ? data : []`, so a history that could not be read printed §3's panel and "Nothing
 * has been delivered for this form yet." underneath the page's own warning that the
 * delivery history could not be loaded. On this screen the false version is the
 * reassuring one: an operator who came here because a consumer reported a missing event
 * would read "nothing has been delivered" as the answer to their question.
 *
 * A failure keeps the heading and the intro, because the alert above needs a subject and
 * a heading claims nothing, and drops the panel and the table, because both are
 * statements about deliveries that were never read. There is no creating action here to
 * preserve: deliveries are made by the system when a response is submitted, which is why
 * the panel has no CTA either.
 */
export function DeliveryDashboard({
  deliveries,
}: {
  readonly deliveries: ReadState<readonly DeliveryItem[]>;
}) {
  /** The rows, or `undefined` when the read failed, which is never drawn as an empty one. */
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

      {/* Three states, not two (issue 572): a failed read draws neither branch, because
          the panel would say nothing has been delivered and the table would say these are
          the deliveries, and the read that would have settled which is the one that
          failed.

          §3's panel. No CTA: deliveries are made by the system when a response is
          submitted, so this screen has no creating action for §3's CTA clause. */}
      {rows !== undefined &&
        (rows.length === 0 ? (
          <EmptyState
            heading={t("ops.deliveries.emptyTitle")}
            body={t("ops.deliveries.empty")}
            testId="qcms-deliveries-empty"
          />
        ) : (
          /* One table family (§2). WHICH COLUMN DROPS AT COMPACT WIDTH: Latency. It is
           the only column here that measures how a delivery went rather than saying
           which delivery it was or where it stands, and the expandable detail row each
           trigger opens carries the per-attempt picture anyway. Event, Target, Status,
           Attempts and Last attempt stay, and so does the trigger column. */
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

/**
 * One delivery: its summary row, and the disclosure row beneath it.
 *
 * Two `<tr>`s rather than a nested table, so the detail stays inside the same row
 * group and a screen reader reading the table linearly meets the detail immediately
 * after the row it belongs to. The trigger is a real `<button>` carrying
 * `aria-expanded`, which is what makes it a disclosure rather than a div that happens
 * to toggle; it names the panel with `aria-controls` for as long as the panel is in
 * the document, and not a moment longer (issue 520).
 */
/**
 * What to show in the response-body panel, which is three different facts wearing the
 * same null (issue #304).
 *
 * `responseSnippet` is null when no response arrived, when the consumer answered with
 * an empty body, **and** when QCMS removed what it answered with - on erasure or when
 * the retention sweep aged it out, because that body is a consumer's bytes verbatim
 * and consumers commonly echo the request in a validation error. The removal case is
 * checked first and reads from its own marker, so the screen never tells an operator
 * the body was empty when in fact it was deleted.
 */
/** One latency, in the row cell, the panel's list and the digest alike. */
function latencyText(latencyMs: number | null): string {
  return latencyMs === null ? t("ops.common.none") : t("ops.deliveries.latency", { ms: latencyMs });
}

/**
 * What the row trigger promises, in three facts (issue 519).
 *
 * Facts, never a judgement: "Dead-lettered, 4 failed attempts, 1240 ms", not
 * "Dead-lettered (needs attention)". Latency drops out of the sentence rather than
 * appearing as "none", because a delivery that has never been attempted has no latency
 * to report and a placeholder there reads as a measurement.
 *
 * Every one of these is also rendered inside the panel, by the same helpers, so the two
 * cannot say different things (`plan/admin-ux-audit.md` §3.7).
 */
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

function responseBodyText(row: DeliveryItem): string {
  if (row.responseSnippetRedactedAt !== null) {
    return t("ops.deliveries.redactedBody", {
      when: formatDateTime(row.responseSnippetRedactedAt, t("ops.common.none")),
    });
  }
  if (row.responseSnippet === null || row.responseSnippet === "") {
    return t("ops.deliveries.emptyBody");
  }
  return row.responseSnippet;
}

/**
 * Exported for the §3.7 test and for nothing else (issue 519).
 *
 * The dashboard's open row is client state, so a static render can only ever produce the
 * collapsed half of the disclosure - and the property under test is a relationship
 * BETWEEN the two halves ("every fact the trigger states, the panel states too"). This
 * component already takes `isOpen` as a prop, so rendering it twice is the whole test,
 * with no jsdom and no browser. Nothing else imports it.
 */
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
          {formatDateTime(row.lastAttemptAt, t("ops.common.none"))}
        </td>
        <td>
          <button
            type="button"
            className="qcms-text-link"
            aria-expanded={isOpen}
            // Named only while the panel exists (issue 520). `aria-controls` is an IDREF,
            // and an IDREF that resolves to nothing is not a weaker reference: it is an
            // invalid one, which is the state this button spent most of its life in,
            // because the panel below is rendered only while the row is open. Axe files
            // that as `incomplete` rather than a violation once `aria-expanded="false"`
            // is present, which is why the gate never said so.
            //
            // The alternative (render the panel always and hide it) was assessed and
            // rejected: it would put a `data-testid="qcms-delivery-detail"` node in every
            // row, and the specs that address that test id unscoped would become
            // strict-mode multi-match failures. Hiding it with `hidden`/`display:none`
            // also removes it from find-in-page, so the "expanded content becomes
            // findable" argument for always rendering does not survive the hiding the
            // accessibility tree requires.
            aria-controls={isOpen ? panelId : undefined}
            onClick={onToggle}
          >
            {t(isOpen ? "ops.deliveries.hideDetail" : "ops.deliveries.showDetail", {
              event: row.eventType,
            })}
            {/* Inside the button, so the digest joins the accessible name rather than
                floating beside it as an unassociated caption: what the trigger promises
                is part of what the trigger is called. */}
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
              {/* Cancellation first, and shown whether or not an attempt was ever
                  made: it is the thing that decides the row's future, and an operator
                  reading a dead-lettered attempt record without it would conclude the
                  event is still waiting to go out. */}
              {row.cancelledAt !== null && (
                <p className="text-sm text-(--color-text)" data-testid="qcms-delivery-cancelled">
                  {cancelledReasonText(row.cancelledReason)} {t("ops.deliveries.cancelledAt")}:{" "}
                  {formatDateTime(row.cancelledAt, t("ops.common.none"))}
                </p>
              )}
              {/* The trigger's three facts, in full, at every width (issue 519). This is
                  what makes the digest a shorthand rather than the only copy: status and
                  attempts are also in row cells, but latency's cell is `display: none`
                  below 40rem, so without this list a narrow viewport would have had the
                  summary as its single source (§3.7).

                  Its `h3` is also what puts the two `h4`s below on a level their parent
                  reaches (issue #541). */}
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
                      {/* Focusable, and named, because it scrolls (issue #309). A
                          rejecting consumer can answer with an HTML error page, and
                          `.qcms-snippet` caps that at 12rem with `overflow: auto` - so
                          without `tabIndex` the rest of the body is reachable by mouse
                          wheel and by nothing else, which is a WCAG 2.1.1 failure and
                          is what axe reports as `scrollable-region-focusable`. The role
                          is what lets it carry a name: `aria-label` on a bare `<pre>`
                          is a prohibited attribute (its role is generic), so the label
                          would have been dropped rather than announced. */}
                      <pre
                        className="qcms-snippet"
                        tabIndex={0}
                        role="region"
                        aria-label={t("ops.deliveries.responseBody")}
                        data-testid="qcms-delivery-response-body"
                      >
                        {responseBodyText(row)}
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
