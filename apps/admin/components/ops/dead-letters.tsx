"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { Alert, Button, Dialog } from "@/components/kit";
import { focusPostAction } from "@/lib/ops/post-action-focus";
import type { DeadLetterItem } from "@/lib/ops/types";
import { unexpected } from "@/lib/ops/unexpected";
import type { ReadState } from "@/lib/read-state";
import { formatDateTime } from "@/lib/i18n/format";
import { t, tPlural } from "@/lib/i18n/en";

/** The outcome of one redelivery request, or of a batch of them. */
export interface RedeliverState {
  readonly status: "idle" | "done" | "error";
  /** How many deliveries this call actually reset. */
  readonly queued?: number;
  /** How many the API refused. Non-zero means the queue below is still partly full. */
  readonly failed?: number;
  readonly message?: string;
}

const IDLE: RedeliverState = { status: "idle" };

/**
 * The dead-letter queue (task 035; wireframe "dead-letter list").
 *
 * This is the reliability story made visible: a delivery that exhausted its retries
 * is not lost and is not silent, it is here with its last error and its attempt
 * count, and it can be put back in the queue once the target is fixed.
 *
 * ## Redelivering queues, it does not deliver
 *
 * `POST /admin/forms/{formId}/deliveries/{deliveryId}/redeliver` resets a row to
 * due-now; the deliverer's next
 * pass makes the attempt. So the confirmation says "queued for the next pass" rather
 * than "delivered", because at the moment the button returns nothing has been sent
 * yet and a message claiming otherwise would be wrong for as long as the pass takes.
 *
 * ## Bulk is a loop, and it reports both halves
 *
 * There is no bulk endpoint (see `lib/server/webhook-ops.ts`), so "Redeliver all"
 * loops. A loop can partly succeed, which is the interesting case: the summary
 * reports queued and refused separately, and the refused ones are still in the table
 * underneath because the server-side refresh re-reads the queue.
 *
 * ## Three states, not two (issue 543)
 *
 * The queue takes a `ReadState`, not an array. It used to take `ok ? data : []`, which
 * made a failed read indistinguishable from an empty one, so a queue that could not be
 * read answered "nothing is stuck" - the reassuring claim, and the false one, on the
 * screen whose whole purpose is answering that question. Contract §3 is the rule it
 * broke: error states are not empty states.
 *
 * On a failure this renders its heading and intro and stops. The heading stays because
 * the alert above it needs a subject and a heading claims nothing about the data, which
 * is what the form list on the same page settled in issue 513. Nothing else survives,
 * and nothing else needs to: every affordance here (redeliver a row, redeliver all)
 * acts on rows that were not read.
 */
export function DeadLetters({
  deadLetters,
  redeliver,
  redeliverAll,
}: {
  readonly deadLetters: ReadState<readonly DeadLetterItem[]>;
  readonly redeliver: (formId: string, deliveryId: string) => Promise<RedeliverState>;
  readonly redeliverAll: (
    targets: readonly { readonly formId: string; readonly deliveryId: string }[],
  ) => Promise<RedeliverState>;
}) {
  /**
   * The rows, or `undefined` when the read failed - which is not the same thing as an
   * empty queue and is never rendered as one. A local `const` rather than a `deadLetters.ok`
   * test at each use, because the bulk dialog's `onPress` is a closure and TypeScript
   * carries a narrowing into one only for a `const` binding, not for a destructured
   * parameter.
   */
  const rows = deadLetters.ok ? deadLetters.data : undefined;

  const [state, setState] = useState<RedeliverState>(IDLE);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);

  // Both redelivery paths remove the control that started them - the row's own button,
  // or the bulk confirmation whose trigger disappears with the last row - so focus is
  // placed on the queue's heading rather than left to a restore that has nothing to
  // restore to (issue #308). `state` is a fresh object on every completed call, so this
  // fires once per action and not on the `IDLE` reset a button press does first.
  useEffect(() => {
    if (state.status !== "done") return undefined;
    return focusPostAction(heading.current);
  }, [state]);

  const run = useCallback((call: () => Promise<RedeliverState>) => {
    startTransition(() => {
      void call()
        .then((next) => {
          setState(next);
          if (next.status !== "error") setConfirming(false);
        })
        // `.catch` is not defensive decoration. `adminApiFetch` documents that it does not
        // throw for a non-2xx, which is true and is the trap: a transport failure still
        // rejects with a TypeError, and `readResult`'s `response.json()` rejects on a
        // truncated body. Without this the promise rejects unhandled, no state is set,
        // and the dialog sits there looking like a slow network forever.
        .catch(() => {
          setState({ status: "error", message: unexpected() });
        });
    });
  }, []);

  return (
    <section
      aria-labelledby="qcms-dead-letters-heading"
      className="flex flex-col gap-3"
      data-testid="qcms-dead-letters"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="qcms-dead-letters-heading"
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold text-(--color-text)"
        >
          {t("ops.deadLetters.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("ops.deadLetters.intro")}</p>
      </div>

      {/* Testid on the region rather than only on its contents, so the `aria-live` can
          be asserted directly: deleting it leaves every content assertion green and axe
          silent, because axe can only judge regions it finds (#359). */}
      <div
        aria-live="polite"
        className="flex flex-col gap-2"
        data-testid="qcms-dead-letters-status"
      >
        {state.status === "error" && (
          <Alert variant="error">
            {t("ops.deadLetters.redeliverFailed", { message: state.message ?? "" })}
          </Alert>
        )}
        {state.status === "done" && (
          <Alert variant="success">
            <span data-testid="qcms-redeliver-summary">{summaryOf(state)}</span>
          </Alert>
        )}
      </div>

      {/* Three states, and the failed one renders none of what follows (issue 543).
          §3's panel otherwise. No CTA: nothing on this screen creates a dead letter (a
          failed delivery does), and an empty queue is the good outcome rather than a gap
          to fill. §3 asks for a CTA only where a creating action exists. */}
      {rows !== undefined &&
        (rows.length === 0 ? (
          <EmptyState
            heading={t("ops.deadLetters.emptyTitle")}
            body={t("ops.deadLetters.empty")}
            testId="qcms-dead-letters-empty"
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p
                className="text-sm text-(--color-text-muted)"
                data-testid="qcms-dead-letters-total"
              >
                {tPlural("ops.deadLetters.total.one", "ops.deadLetters.total.other", rows.length)}
              </p>
              <Button
                variant="secondary"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  setState(IDLE);
                  setConfirming(true);
                }}
              >
                {t("ops.deadLetters.redeliverAll")}
              </Button>
            </div>

            {/* One table family (§2). WHICH COLUMN DROPS AT COMPACT WIDTH: Last error.
              It is the widest cell here by a long way (a raw upstream error string) and
              it describes a failure rather than identifying the delivery. Event, Target,
              Attempts and Dead-lettered-at are what an operator scans to decide whether
              to redeliver, and the redeliver control travels with them. */}
            <div className="qcms-table">
              <table data-testid="qcms-dead-letters-table">
                <caption className="qcms-visually-hidden">{t("ops.deadLetters.table")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("ops.deadLetters.column.event")}</th>
                    <th scope="col">{t("ops.deadLetters.column.target")}</th>
                    <th scope="col" className="qcms-cell--num">
                      {t("ops.deadLetters.column.attempts")}
                    </th>
                    <th scope="col" className="qcms-cell--drop">
                      {t("ops.deadLetters.column.lastError")}
                    </th>
                    <th scope="col" className="qcms-cell--num">
                      {t("ops.deadLetters.column.deadLetteredAt")}
                    </th>
                    <th scope="col">
                      <span className="qcms-visually-hidden">{t("ops.deadLetters.redeliver")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.deliveryId} data-delivery-id={row.deliveryId}>
                      <th scope="row">
                        <code className="qcms-link-id">{row.eventType}</code>
                      </th>
                      <td>
                        <span className="qcms-link-url">{row.url}</span>
                      </td>
                      <td className="qcms-cell--num">{row.attempts}</td>
                      <td className="qcms-cell--drop">
                        <code data-testid="qcms-dead-letter-error">
                          {row.lastError ?? t("ops.common.none")}
                        </code>
                      </td>
                      <td className="qcms-cell--num">
                        {formatDateTime(row.deadLetteredAt, t("ops.common.none"))}
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          size="sm"
                          isDisabled={isPending}
                          onPress={() => {
                            setState(IDLE);
                            run(() => redeliver(row.formId, row.deliveryId));
                          }}
                        >
                          <span className="qcms-visually-hidden">
                            {t("ops.deadLetters.redeliverOne", {
                              event: row.eventType,
                              target: row.url,
                            })}
                          </span>
                          <span aria-hidden="true">{t("ops.deadLetters.redeliver")}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}

      {/* The dialog cannot outlive its rows: its only trigger lives in the branch above,
          and gating it on `rows` too is what lets the confirm below name its targets
          without a fallback array standing in for a queue nobody read (issue 543). */}
      {confirming && rows !== undefined && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("ops.deadLetters.redeliverAllTitle")}
          description={t("ops.deadLetters.redeliverAllBody")}
          isDismissable={!isPending}
          onOpenChange={(isOpen) => {
            if (!isOpen) setConfirming(false);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              isDisabled={isPending}
              onPress={() => {
                run(() =>
                  redeliverAll(
                    rows.map((row) => ({ formId: row.formId, deliveryId: row.deliveryId })),
                  ),
                );
              }}
            >
              {isPending ? t("ops.common.working") : t("ops.deadLetters.confirmRedeliverAll")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              isDisabled={isPending}
              onPress={() => {
                setConfirming(false);
              }}
            >
              {t("ops.common.cancel")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/**
 * The sentence for a completed redelivery.
 *
 * A partial result gets its own sentence naming both numbers, rather than a success
 * message that quietly under-reports: "3 queued" next to a table that still has two
 * rows in it is the exact shape of a message an operator would misread as done.
 */
function summaryOf(state: RedeliverState): string {
  const queued = state.queued ?? 0;
  const failed = state.failed ?? 0;
  if (failed > 0) return t("ops.deadLetters.redeliverPartial", { queued, failed });
  return tPlural("ops.deadLetters.queued.one", "ops.deadLetters.queued.other", queued);
}
