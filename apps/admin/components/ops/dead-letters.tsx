"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Alert, Button, Dialog } from "@/components/kit";
import { focusPostAction } from "@/lib/ops/post-action-focus";
import type { DeadLetterItem } from "@/lib/ops/types";
import { unexpected } from "@/lib/ops/unexpected";
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
 * `POST /admin/outbox/{id}/redeliver` resets a row to due-now; the deliverer's next
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
 */
export function DeadLetters({
  deadLetters,
  redeliver,
  redeliverAll,
}: {
  readonly deadLetters: readonly DeadLetterItem[];
  readonly redeliver: (deliveryId: string) => Promise<RedeliverState>;
  readonly redeliverAll: (deliveryIds: readonly string[]) => Promise<RedeliverState>;
}) {
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

      <div aria-live="polite" className="flex flex-col gap-2">
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

      {deadLetters.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-dead-letters-empty">
          {t("ops.deadLetters.empty")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-(--color-text-muted)" data-testid="qcms-dead-letters-total">
              {tPlural(
                "ops.deadLetters.total.one",
                "ops.deadLetters.total.other",
                deadLetters.length,
              )}
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

          <table className="qcms-ops-table" data-testid="qcms-dead-letters-table">
            <caption className="qcms-visually-hidden">{t("ops.deadLetters.table")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("ops.deadLetters.column.event")}</th>
                <th scope="col">{t("ops.deadLetters.column.target")}</th>
                <th scope="col">{t("ops.deadLetters.column.attempts")}</th>
                <th scope="col">{t("ops.deadLetters.column.lastError")}</th>
                <th scope="col">{t("ops.deadLetters.column.deadLetteredAt")}</th>
                <th scope="col">
                  <span className="qcms-visually-hidden">{t("ops.deadLetters.redeliver")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {deadLetters.map((row) => (
                <tr key={row.deliveryId} data-delivery-id={row.deliveryId}>
                  <th scope="row">
                    <code className="qcms-link-id">{row.eventType}</code>
                  </th>
                  <td>
                    <span className="qcms-link-url">{row.url}</span>
                  </td>
                  <td>{row.attempts}</td>
                  <td>
                    <code data-testid="qcms-dead-letter-error">
                      {row.lastError ?? t("ops.common.none")}
                    </code>
                  </td>
                  <td>{formatDateTime(row.deadLetteredAt, t("ops.common.none"))}</td>
                  <td>
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={isPending}
                      onPress={() => {
                        setState(IDLE);
                        run(() => redeliver(row.deliveryId));
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
        </>
      )}

      {confirming && (
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
                run(() => redeliverAll(deadLetters.map((row) => row.deliveryId)));
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
