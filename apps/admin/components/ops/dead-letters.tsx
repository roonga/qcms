"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { useEnvironmentUnknown } from "@/components/environment-scope";
import { Alert, Button, Dialog } from "@/components/kit";
import { focusPostAction } from "@/lib/ops/post-action-focus";
import type { DeadLetterItem } from "@/lib/ops/types";
import { unexpected } from "@/lib/ops/unexpected";
import type { ReadState } from "@/lib/read-state";
import { OperatorDateTime } from "@/components/operator-time";
import { t, tPlural } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";

export interface RedeliverState {
  readonly status: "idle" | "done" | "error";
  readonly queued?: number;
  readonly failed?: number;
  readonly message?: string;
}

const IDLE: RedeliverState = { status: "idle" };

/* Redelivery queues work rather than sending immediately; bulk results must report both queued and refused
   items. */
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
  /* Keep the narrowed rows in a const so TypeScript preserves the read-state narrowing inside dialog
     callbacks. */
  const rows = deadLetters.ok ? deadLetters.data : undefined;

  const [state, setState] = useState<RedeliverState>(IDLE);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const environmentUnknown = useEnvironmentUnknown();
  const heading = useRef<HTMLHeadingElement>(null);

  // Redelivery removes its own trigger; focus the queue heading after completion instead of restoring a
  // vanished button.
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
              <HeadingMarker control="deadletters.redeliver">
                <Button
                  variant="secondary"
                  size="md"
                  isDisabled={isPending || environmentUnknown}
                  onPress={() => {
                    setState(IDLE);
                    setConfirming(true);
                  }}
                >
                  {t("ops.deadLetters.redeliverAll")}
                </Button>
              </HeadingMarker>
            </div>

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
                        <OperatorDateTime
                          iso={row.deadLetteredAt}
                          fallback={t("ops.common.none")}
                        />
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          size="sm"
                          isDisabled={isPending || environmentUnknown}
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
          <div className="flex flex-col gap-4">
            {state.status === "error" && (
              <Alert variant="error">
                {t("ops.deadLetters.redeliverFailed", { message: state.message ?? "" })}
              </Alert>
            )}
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
          </div>
        </Dialog>
      )}
    </section>
  );
}

function summaryOf(state: RedeliverState): string {
  const queued = state.queued ?? 0;
  const failed = state.failed ?? 0;
  if (failed > 0) return t("ops.deadLetters.redeliverPartial", { queued, failed });
  return tPlural("ops.deadLetters.queued.one", "ops.deadLetters.queued.other", queued);
}
