"use client";

import { useState, useTransition } from "react";

import { Alert, Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import type { MembershipActionState, WorkspaceMember } from "@/lib/membership/types";

/**
 * The membership list, and the one grant that is not an access group (Q32, Q35; task 069).
 *
 * `forms.owner` lives on the **member row** rather than on a team, so it is set here and
 * nowhere else, and both directions are written to the access audit because both change
 * what somebody may do.
 *
 * **The empty role is named rather than shown as a bare word.** A row carrying the
 * library's own `member` name grants nothing at all and exists so a team grant is
 * expressible (finding G); rendered as "member" it would read as a rank, which is the one
 * thing this model does not have.
 *
 * **The groups each member holds are in the list.** Finding 17's point is that access is
 * visible rather than inferred, and a list of member rows alone would say nothing about
 * what anybody may do.
 */
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
    <section aria-labelledby="qcms-members-heading" className="flex flex-col gap-3">
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--color-text-muted)">
                <th scope="col">{t("membership.members.columnEmail")}</th>
                <th scope="col">{t("membership.members.columnRole")}</th>
                <th scope="col">{t("membership.members.columnGroups")}</th>
                <th scope="col">
                  <span className="sr-only">{t("membership.members.makeOwner")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const owner = member.role === "forms.owner";
                return (
                  <tr key={member.userId} className="align-top">
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
        ))}
    </section>
  );
}
