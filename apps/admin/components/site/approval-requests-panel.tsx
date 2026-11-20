"use client";

import { useState, useTransition } from "react";

import { Alert, Button } from "@/components/kit";
import { OperatorDateTime, useOperatorDayFormat } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import { expiryWording } from "@/lib/membership/approval-wording";
import type { RoleActState } from "@/lib/site/administrators";
import {
  approvalStatusLabel,
  decisionBlockText,
  type DecisionControl,
  type SiteApprovalRequest,
} from "@/lib/site/approvals";

import { StepUpDialog, type StepUpCredentials } from "./step-up-dialog";

/** One request as the server read it: its sentence, its workspace and who may decide it here. */
export interface ApprovalRow {
  readonly request: SiteApprovalRequest;
  readonly asked: string;
  readonly workspace: string | undefined;
  readonly decidedBy: string;
  readonly expiresInDays: number;
  readonly control: DecisionControl;
}

const STATUS_TONE: Readonly<Record<string, string>> = {
  pending: "qcms-tag qcms-tag--deprecated",
  approved: "qcms-tag qcms-tag--published",
};

function endedText(row: ApprovalRow, expiredOn: string): string {
  const { request } = row;
  if (request.status === "expired") return decisionBlockText("expired", expiredOn);
  if (request.status === "approved")
    return t("membership.requests.status.approved", { person: row.decidedBy });
  if (request.status === "rejected")
    return t("membership.requests.status.rejected", { person: row.decidedBy });
  return t("membership.requests.status.lapsed", { person: row.decidedBy });
}

function DecisionLabel({
  visible,
  named,
}: {
  readonly visible: "approve" | "reject";
  readonly named: string;
}) {
  return (
    <>
      <span aria-hidden="true">
        {t(visible === "approve" ? "membership.requests.approve" : "membership.requests.reject")}
      </span>
      <span className="qcms-visually-hidden">
        {t(
          visible === "approve"
            ? "membership.requests.approveFor"
            : "membership.requests.rejectFor",
          {
            request: named,
          },
        )}
      </span>
    </>
  );
}

/* The API decides every request: hiding Approve from the person who asked is a courtesy, not the check. */
export function ApprovalRequestsPanel({
  rows,
  decideSite,
  decideWorkspace,
}: {
  readonly rows: readonly ApprovalRow[];
  readonly decideSite: (
    requestId: string,
    decision: "approve" | "reject",
    credentials?: StepUpCredentials,
  ) => Promise<RoleActState>;
  readonly decideWorkspace: (
    workspaceId: string,
    requestId: string,
    decision: "approve" | "reject",
  ) => Promise<RoleActState>;
}) {
  const day = useOperatorDayFormat();
  const [state, setState] = useState<RoleActState>({ status: "idle" });
  const [approving, setApproving] = useState<ApprovalRow | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const decide = (row: ApprovalRow, decision: "approve" | "reject") => {
    setState({ status: "idle" });
    if (decision === "approve" && row.control.kind === "decide" && row.control.stepUp) {
      setFailure(undefined);
      setApproving(row);
      return;
    }
    startTransition(async () => {
      const { request } = row;
      setState(
        request.scope === "workspace" && request.workspaceId !== null
          ? await decideWorkspace(request.workspaceId, request.requestId, decision)
          : await decideSite(request.requestId, decision),
      );
    });
  };

  const confirmApprove = (credentials: StepUpCredentials) => {
    if (approving === undefined) return;
    const requestId = approving.request.requestId;
    startTransition(async () => {
      const result = await decideSite(requestId, "approve", credentials);
      if (result.status === "error") {
        setFailure(result.message);
        return;
      }
      setApproving(undefined);
      setState(result);
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="qcms-approval-requests">
      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "done" && <Alert variant="success">{state.message}</Alert>}

      <ul className="flex min-w-0 flex-col gap-3">
        {rows.map((row) => {
          const { request, control } = row;
          return (
            <li
              key={request.requestId}
              data-request={request.requestId}
              data-request-status={request.status}
              className="flex min-w-0 flex-col gap-2 rounded-(--radius-card) border border-(--color-border) px-4 py-3"
            >
              <p className="text-sm font-medium">{row.asked}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm text-(--color-text-muted)">
                <span className={STATUS_TONE[request.status] ?? "qcms-tag"}>
                  {approvalStatusLabel(request.status)}
                </span>
                <span className="qcms-tag qcms-tag--draft">
                  {row.workspace === undefined
                    ? t("site.requests.scope.site")
                    : t("site.requests.scope.workspaceNamed", { workspace: row.workspace })}
                </span>
                <span>
                  {t("site.requests.requestedAt")} <OperatorDateTime iso={request.requestedAt} />
                </span>
                {control.kind === "decide" && <span>{expiryWording(row.expiresInDays)}</span>}
              </p>
              {control.kind === "decided" && (
                <p className="text-sm text-(--color-text-muted)">
                  {endedText(row, day(request.expiresAt, ""))}
                </p>
              )}
              {control.kind === "blocked" && (
                <p
                  className="text-sm text-(--color-text-muted)"
                  data-decision-blocked={control.reason}
                >
                  {decisionBlockText(control.reason, day(request.expiresAt, ""))}
                </p>
              )}
              {control.kind === "decide" && (
                <div className="flex flex-wrap gap-2">
                  <Button isDisabled={pending} onPress={() => decide(row, "approve")}>
                    <DecisionLabel visible="approve" named={row.asked} />
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={pending}
                    onPress={() => decide(row, "reject")}
                  >
                    <DecisionLabel visible="reject" named={row.asked} />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {approving !== undefined && (
        <StepUpDialog
          title={t("site.requests.approveTitle")}
          act={t("membership.requests.approve")}
          pending={pending}
          error={failure}
          onConfirm={confirmApprove}
          onCancel={() => {
            setApproving(undefined);
            setFailure(undefined);
          }}
        >
          <p className="text-sm">{approving.asked}</p>
        </StepUpDialog>
      )}
    </div>
  );
}
