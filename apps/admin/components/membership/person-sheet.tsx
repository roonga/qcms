"use client";

import Link from "next/link";

import { AccessExplanation } from "@/components/access/access-explanation";
import { AdministratorRemoval } from "@/components/access/last-administrator";
import { Button, Dialog } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { groupScope, roleDescription } from "@/lib/membership/access-group-form";
import type { AccessCapabilities } from "@/lib/membership/access-patterns";
import { liveGrants, offersReconfirm, type PersonHold, type PersonRow } from "@/lib/membership/people";

import { SuspendedTag } from "./suspended-tag";

export type PersonAct =
  | { readonly kind: "appoint" }
  | { readonly kind: "removeAdministrator" }
  | { readonly kind: "revoke"; readonly hold: PersonHold }
  | { readonly kind: "reconfirm"; readonly hold: PersonHold }
  | { readonly kind: "removeFromWorkspace" };

/** One person's access in this workspace, and the acts on it; each act is confirmed by the caller. */
export function PersonSheet({
  person,
  workspaceName,
  viewerId,
  environments,
  capabilities,
  isLast,
  grantHref,
  groupHref,
  appointHref,
  pending,
  onAct,
  onClose,
}: {
  readonly person: PersonRow;
  readonly workspaceName: string;
  readonly viewerId: string;
  readonly environments: readonly string[];
  readonly capabilities: AccessCapabilities;
  readonly isLast: boolean;
  readonly grantHref: string;
  readonly groupHref: (teamId: string) => string;
  readonly appointHref: string;
  readonly pending: boolean;
  readonly onAct: (act: PersonAct) => void;
  readonly onClose: () => void;
}) {
  const label = person.name === "" ? person.email : person.name;
  return (
    <Dialog
      isOpen
      title={label}
      isDismissable={!pending}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <div className="flex min-w-0 flex-col gap-4" data-testid="qcms-person-sheet">
        <p className="text-sm break-all text-(--color-text-muted)">{person.email}</p>

        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("membership.person.administrator")}</p>
            <p className="text-sm text-(--color-text-muted)">
              {roleDescription("forms.owner")}
            </p>
          </div>
          {person.administrator ? (
            <AdministratorRemoval
              scope="workspace"
              person={label}
              workspace={workspaceName}
              isLast={isLast}
              capabilities={capabilities}
              appointHref={appointHref}
              pending={pending}
              onPress={() => {
                onAct({ kind: "removeAdministrator" });
              }}
            />
          ) : (
            <Button
              variant="secondary"
              size="md"
              isDisabled={pending}
              aria-label={t("membership.person.appointFor", { person: label })}
              onPress={() => {
                onAct({ kind: "appoint" });
              }}
            >
              {t("membership.person.appoint")}
            </Button>
          )}
        </div>

        <AccessExplanation
          person={label}
          workspace={workspaceName}
          groups={liveGrants(person)}
          environments={environments}
          capabilities={capabilities}
          groupHref={(group) => groupHref(group.id)}
        />

        <section aria-labelledby="qcms-person-groups" className="flex min-w-0 flex-col gap-2">
          <h3 id="qcms-person-groups" className="text-sm font-semibold">
            {t("membership.person.groups")}
          </h3>
          {person.holds.length === 0 ? (
            <p className="text-sm text-(--color-text-muted)">{t("membership.person.noGroups")}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2">
              {person.holds.map((hold) => (
                <li
                  key={hold.group.teamId}
                  className="flex min-w-0 flex-wrap items-center gap-2 border-t border-(--color-border) pt-2"
                  data-hold={hold.group.name}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-sm">{hold.group.name}</span>{" "}
                    {hold.suspended && <SuspendedTag />}
                    <span className="block text-xs text-(--color-text-muted)">
                      {groupScope(hold.group)}
                    </span>
                    {hold.suspended && !offersReconfirm(viewerId, person.userId, true) && (
                      <span className="block text-xs text-(--color-text-muted)">
                        {t("membership.person.reconfirmOwn")}
                      </span>
                    )}
                  </span>
                  {offersReconfirm(viewerId, person.userId, hold.suspended) && (
                    <Button
                      size="md"
                      isDisabled={pending}
                      aria-label={t("membership.person.reconfirmFor", {
                        person: label,
                        group: hold.group.name,
                      })}
                      onPress={() => {
                        onAct({ kind: "reconfirm", hold });
                      }}
                    >
                      {t("membership.person.reconfirm")}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="md"
                    isDisabled={pending}
                    aria-label={t("membership.person.revokeFor", {
                      person: label,
                      group: hold.group.name,
                    })}
                    onPress={() => {
                      onAct({ kind: "revoke", hold });
                    }}
                  >
                    {t("membership.groups.removeHolder")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Link href={grantHref} className="qcms-button-link qcms-button-link--secondary">
              {t("membership.person.addToGroup")}
            </Link>
          </div>
        </section>

        <div className="flex min-w-0 flex-col items-start gap-1 border-t border-(--color-border) pt-3">
          <p className="text-sm text-(--color-text-muted)">
            {t("membership.person.removeNote", { person: label, workspace: workspaceName })}
          </p>
          <Button
            variant="danger"
            size="md"
            isDisabled={pending || (person.administrator && isLast)}
            onPress={() => {
              onAct({ kind: "removeFromWorkspace" });
            }}
          >
            {t("membership.person.removeFromWorkspace")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
