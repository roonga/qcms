"use client";

import { useState, useTransition } from "react";

import { HelpTip } from "@/components/help-tip";
import { Alert, Button } from "@/components/kit";
import { t, tPlural } from "@/lib/i18n/en";
import {
  askedSentence,
  decidedSentence,
  expiryWording,
  personLabel,
  type HeldRequest,
} from "@/lib/membership/approval-wording";
import type { MembershipActionState } from "@/lib/membership/types";

/* The API decides every request: hiding Approve from the person who asked is a courtesy, not the check. */
export function WorkspaceRequestsPanel({
  workspaceId,
  requests,
  message,
  viewerId,
  people,
  decide,
}: {
  readonly workspaceId: string;
  readonly requests: readonly HeldRequest[] | undefined;
  readonly message: string | undefined;
  readonly viewerId: string;
  /** Each account by its address, read from this workspace's members. */
  readonly people: ReadonlyMap<string, string>;
  readonly decide: (
    workspaceId: string,
    requestId: string,
    decision: "approve" | "reject",
  ) => Promise<MembershipActionState>;
}) {
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const waiting = (requests ?? []).filter((entry) => entry.request.status === "pending");

  return (
    <section
      aria-labelledby="qcms-workspace-requests-heading"
      className="flex min-w-0 flex-col gap-3"
      data-testid="qcms-workspace-requests"
    >
      <div className="qcms-help-head">
        <h2
          id="qcms-workspace-requests-heading"
          className="text-lg font-semibold text-(--color-text)"
        >
          {t("membership.requests.heading")}
        </h2>
        {waiting.length > 0 && (
          <span className="qcms-tag qcms-tag--deprecated">
            {tPlural(
              "membership.requests.pendingOne",
              "membership.requests.pending",
              waiting.length,
            )}
          </span>
        )}
        <HelpTip>{t("membership.requests.intro")}</HelpTip>
      </div>

      {requests === undefined && (
        <Alert variant="error">
          {t("membership.requests.loadFailed", { message: message ?? "" })}
        </Alert>
      )}
      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "done" && <Alert variant="success">{state.message}</Alert>}

      {requests !== undefined &&
        (requests.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.requests.none")}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {requests.map((entry) => {
              const asked = askedSentence(
                entry.request,
                personLabel(entry.request.requestedBy, people),
              );
              const own = entry.request.requestedBy === viewerId;
              return (
                <li
                  key={entry.request.requestId}
                  data-request={entry.request.requestId}
                  className="flex min-w-0 flex-col gap-2 rounded-(--radius-card) border border-(--color-border) px-4 py-3"
                >
                  <p className="text-sm">{asked}</p>
                  {entry.request.status === "pending" ? (
                    <>
                      <p className="flex flex-wrap items-center gap-2 text-sm text-(--color-text-muted)">
                        <span className="qcms-tag qcms-tag--deprecated">
                          {t("membership.requests.waiting")}
                        </span>
                        {expiryWording(entry.expiresInDays)}
                      </p>
                      {own ? (
                        <p className="text-sm text-(--color-text-muted)">
                          {t("membership.requests.ownRequest")}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            isDisabled={pending}
                            aria-label={t("membership.requests.approveFor", { request: asked })}
                            onPress={() => {
                              startTransition(async () => {
                                setState(
                                  await decide(
                                    workspaceId,
                                    entry.request.requestId,
                                    "approve",
                                  ),
                                );
                              });
                            }}
                          >
                            {t("membership.requests.approve")}
                          </Button>
                          <Button
                            variant="secondary"
                            isDisabled={pending}
                            aria-label={t("membership.requests.rejectFor", { request: asked })}
                            onPress={() => {
                              startTransition(async () => {
                                setState(
                                  await decide(workspaceId, entry.request.requestId, "reject"),
                                );
                              });
                            }}
                          >
                            {t("membership.requests.reject")}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-(--color-text-muted)">
                      {decidedSentence(
                        entry.request,
                        personLabel(entry.request.decidedBy, people),
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
