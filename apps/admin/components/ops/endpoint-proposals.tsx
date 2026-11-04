"use client";

import { useCallback, useState, useTransition } from "react";

import { useEnvironmentUnknown } from "@/components/environment-scope";
import { EntityId } from "@/components/entity-id";
import { Alert, Button, Dialog } from "@/components/kit";
import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import type { EndpointProposal } from "@/lib/ops/types";
import { unexpected } from "@/lib/ops/unexpected";
import type { ReadState } from "@/lib/read-state";

import type { WebhookActionState } from "./webhook-config";

/* Keep proposed endpoints separate from live ones; two-person approval requires seeing the proposed value
   without implying it is active. */
/* Name each change kind: deactivation and updates without a URL cannot promise delivery to a new target. */
function dialogSentence(act: "confirm" | "withdraw", proposal: EndpointProposal): string {
  const environment = proposal.environment;
  if (act === "withdraw") {
    return proposal.confirmedAt === null
      ? t("ops.proposals.withdrawBody", { environment })
      : t("ops.proposals.withdrawBodyConfirmed", { environment });
  }
  if (proposal.kind === "deactivate") {
    return t("ops.proposals.confirmBody.deactivate", { environment });
  }
  if (proposal.url === null) {
    return t("ops.proposals.confirmBody.update", { environment });
  }
  return proposal.kind === "create"
    ? t("ops.proposals.confirmBody.create", { environment, url: proposal.url })
    : t("ops.proposals.confirmBody.retarget", { environment, url: proposal.url });
}

export function EndpointProposals({
  proposals,
  confirm,
  withdraw,
}: {
  readonly proposals: ReadState<readonly EndpointProposal[]>;
  readonly confirm: (proposalId: string) => Promise<WebhookActionState>;
  readonly withdraw: (proposalId: string) => Promise<WebhookActionState>;
}) {
  const rows = proposals.ok ? proposals.data : undefined;
  const [dialog, setDialog] = useState<{
    readonly act: "confirm" | "withdraw";
    readonly proposal: EndpointProposal;
  } | null>(null);
  const [state, setState] = useState<WebhookActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const environmentUnknown = useEnvironmentUnknown();

  const run = useCallback((call: () => Promise<WebhookActionState>) => {
    startTransition(() => {
      void call()
        .then((next) => {
          setState(next);
          if (next.status === "done") setDialog(null);
        })
        .catch(() => {
          setState({ status: "error", message: unexpected() });
        });
    });
  }, []);

  if (rows === undefined || rows.length === 0) return null;

  return (
    <section
      aria-labelledby="qcms-endpoint-proposals-heading"
      className="flex flex-col gap-4"
      data-testid="qcms-endpoint-proposals"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="qcms-endpoint-proposals-heading"
          className="text-lg font-semibold text-(--color-text)"
        >
          {t("ops.proposals.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("ops.proposals.intro")}</p>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2" data-testid="qcms-proposal-status">
        {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      </div>

      <div className="qcms-table">
        <table data-testid="qcms-proposal-table">
          <caption className="qcms-visually-hidden">{t("ops.proposals.table")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("ops.proposals.column.endpoint")}</th>
              <th scope="col">{t("ops.proposals.column.change")}</th>
              <th scope="col">{t("ops.proposals.column.proposedBy")}</th>
              <th scope="col">{t("ops.proposals.column.state")}</th>
              <th scope="col">
                <span className="qcms-visually-hidden">{t("ops.proposals.column.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((proposal) => {
              const waiting = proposal.confirmedAt === null;
              return (
                <tr key={proposal.proposalId} data-proposal={proposal.proposalId}>
                  <th scope="row">
                    <EntityId kind="webhook" value={proposal.webhookId} />
                  </th>
                  <td>
                    <span className="block">{t(`ops.proposals.kind.${proposal.kind}`)}</span>
                    {proposal.url !== null && (
                      <span className="block text-xs break-all text-(--color-text-muted)">
                        {proposal.url}
                      </span>
                    )}
                    {proposal.rotatesSecret && (
                      <span className="block text-xs text-(--color-text-muted)">
                        {t("ops.proposals.rotates")}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="block break-all">{proposal.proposedBy}</span>
                    <span className="block text-xs text-(--color-text-muted)">
                      <OperatorDateTime iso={proposal.proposedAt} />
                    </span>
                  </td>
                  <td>
                    {waiting
                      ? t("ops.proposals.state.waiting")
                      : t("ops.proposals.state.unapplied")}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        isDisabled={isPending || environmentUnknown}
                        onPress={() => {
                          setState({ status: "idle" });
                          setDialog({ act: "confirm", proposal });
                        }}
                      >
                        {t("ops.proposals.confirm")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        isDisabled={isPending || environmentUnknown}
                        onPress={() => {
                          setState({ status: "idle" });
                          setDialog({ act: "withdraw", proposal });
                        }}
                      >
                        {t("ops.proposals.withdraw")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog !== null && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t(`ops.proposals.${dialog.act}Title`)}
          isDismissable={!isPending}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <div className="flex flex-col gap-4" data-testid="qcms-proposal-dialog">
            <p className="text-sm">{dialogSentence(dialog.act, dialog.proposal)}</p>
            <p className="text-sm font-semibold" data-testid="qcms-proposal-environment">
              {t("environment.inThis", { environment: dialog.proposal.environment })}
            </p>
            {dialog.act === "confirm" && (
              <Alert variant="warning">{t("ops.proposals.confirmWarning")}</Alert>
            )}
            {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  run(() =>
                    dialog.act === "confirm"
                      ? confirm(dialog.proposal.proposalId)
                      : withdraw(dialog.proposal.proposalId),
                  );
                }}
              >
                {t(`ops.proposals.${dialog.act}`)}
              </Button>
              <Button
                variant="ghost"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  setDialog(null);
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
