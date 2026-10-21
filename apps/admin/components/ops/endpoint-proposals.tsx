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

/**
 * The endpoint changes waiting for a second approver (ADR-41's release rule, Q30, Q51;
 * task 070).
 *
 * ## Why this is a panel and not a line in the endpoint table
 *
 * A pending change is **not a state of an endpoint**. It is a proposed value that is not
 * live, and the endpoint beside it is doing exactly what it was doing before - so a row
 * showing "https://new-target" under an endpoint's URL column would be the one thing this
 * mechanism exists to prevent somebody believing. The two-person rule's whole point is that
 * the operator can read the proposed value *without* it being in force, and a separate
 * panel is what makes the difference visible rather than inferable.
 *
 * ## Two accounts, named
 *
 * Each row names the account that proposed the change, because the account reading the
 * screen has to be able to tell whether it is their own: the proposer cannot confirm their
 * own proposal, and a screen that offered them a Confirm button leading to a 403 would be
 * teaching the rule by refusing. The button is still rendered for them and still refused
 * by the API - this app decides nothing (R2) - but the row says whose proposal it is and
 * the confirm control carries the warning.
 *
 * ## Withdraw is either account's
 *
 * The proposer changing their mind and a second approver refusing the change are the same
 * act on the row, and which it was is in the audit. So there is one Withdraw rather than a
 * Reject beside a Cancel: a third state would be a third thing for this panel to explain
 * and the record already says who ended it.
 *
 * ## A confirmed change whose apply has not landed
 *
 * `confirmedAt` with `appliedAt` still null is the two-pool window: the proposal is
 * control-plane state and the endpoint is the environment's, so a confirmation whose
 * endpoint write failed leaves the record saying somebody agreed and the endpoint **not**
 * live. The row says so in those words, and Confirm stays available because pressing it
 * again finishes the apply without recording a second confirmation.
 */
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
  // Every control here acts in one environment's data plane (A12).
  const environmentUnknown = useEnvironmentUnknown();

  const run = useCallback((call: () => Promise<WebhookActionState>) => {
    startTransition(() => {
      void call()
        .then((next) => {
          setState(next);
          if (next.status === "done") setDialog(null);
        })
        // `adminApiFetch` does not throw on a non-2xx, which is the trap: a transport
        // failure still rejects, and without this the dialog sits there looking like a
        // slow network forever.
        .catch(() => {
          setState({ status: "error", message: unexpected() });
        });
    });
  }, []);

  // Nothing waiting, and nothing to say about it. The two-person rule gates `prod` alone
  // and is off by default (Q13), so an empty panel is the ordinary case on every screen -
  // and an empty state here would put a permanent "no pending changes" block on a screen
  // where that is never news. A failed read is the same: the page's own alert says so.
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
              // Computed before the cell rather than in it. A ternary on `confirmedAt`
              // inside a `<td>` is an instant in cell text as far as the table-cell rule
              // is concerned, and that rule is right to be blunt about it: a timestamp
              // belongs in `OperatorDateTime`, and what this column renders is a state.
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
                    {/* The account, as the release history already shows an actor: plain
                      text, because an account id is not one of the entity kinds this app
                      abbreviates and a truncated one is the half an operator needs. */}
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
            <p className="text-sm">
              {t(`ops.proposals.${dialog.act}Body`, {
                environment: dialog.proposal.environment,
                url: dialog.proposal.url ?? "",
              })}
            </p>
            {/* Q6's restatement: an act performed against the wrong environment is not
                undoable, and confirming one of these is what makes a production endpoint
                live. */}
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
