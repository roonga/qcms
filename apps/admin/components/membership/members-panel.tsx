"use client";

import { useState, useTransition } from "react";

import { Alert, Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";
import type { MembershipActionState, WorkspaceMember } from "@/lib/membership/types";

/* The library's member role grants nothing by itself; forms.owner belongs to the member row, independently
   of groups. */
export function MembersPanel({
  workspaceId,
  members,
  message,
  setRole,
}: {
  readonly workspaceId: string;
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly message: string | undefined;
  readonly setRole: (
    workspaceId: string,
    userId: string,
    role: "forms.owner" | "member",
  ) => Promise<MembershipActionState>;
}) {
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  return (
    <section aria-labelledby="qcms-members-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="qcms-members-heading" className="text-lg font-semibold text-(--color-text)">
          {t("membership.members.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("membership.members.intro")}</p>
      </div>

      {members === undefined && (
        <Alert variant="error">
          {t("membership.members.loadFailed", { message: message ?? "" })}
        </Alert>
      )}
      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "done" && <Alert variant="success">{state.message}</Alert>}

      {members !== undefined &&
        (members.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.members.none")}</p>
        ) : (
          <HeadingMarker control="membership.memberRole" block>
            <div className="qcms-table qcms-table--wide min-w-0">
              <table>
                <caption className="qcms-visually-hidden">{t("membership.members.table")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("membership.members.columnEmail")}</th>
                    <th scope="col">{t("membership.members.columnRole")}</th>
                    <th scope="col">{t("membership.members.columnGroups")}</th>
                    <th scope="col">
                      <span className="qcms-visually-hidden">
                        {t("membership.members.makeOwner")}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const owner = member.role === "forms.owner";
                    return (
                      <tr key={member.userId}>
                        <td>{member.email}</td>
                        <td>
                          {owner
                            ? t("membership.members.ownerRole")
                            : t("membership.members.emptyRole")}
                        </td>
                        <td>
                          {member.groups.length === 0
                            ? t("membership.members.noGroups")
                            : member.groups.join(", ")}
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            isDisabled={pending}
                            onPress={() => {
                              startTransition(async () => {
                                setState(
                                  await setRole(
                                    workspaceId,
                                    member.userId,
                                    owner ? "member" : "forms.owner",
                                  ),
                                );
                              });
                            }}
                          >
                            {owner
                              ? t("membership.members.removeOwner")
                              : t("membership.members.makeOwner")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HeadingMarker>
        ))}
    </section>
  );
}
