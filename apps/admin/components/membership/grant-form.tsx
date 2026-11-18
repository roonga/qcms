"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { AccessPreview } from "@/components/access/access-preview";
import { HeadingMarker } from "@/components/agent/heading-marker";
import { HelpTip } from "@/components/help-tip";
import { Alert, Button, Select, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { groupScope } from "@/lib/membership/access-group-form";
import { accessDelta } from "@/lib/membership/access-patterns";
import { holdsForApproval } from "@/lib/membership/group-edit";
import { grantOf, liveGrants, type PersonRow } from "@/lib/membership/people";
import { looksLikeAddress } from "@/lib/membership/workspace-views";
import type { AccessGroup, MembershipActionState } from "@/lib/membership/types";

/** Grant by exact address: the only way a Workspace administrator adds somebody. */
export function GrantForm({
  workspaceId,
  groups,
  people,
  environments,
  viewerEmail,
  requireSecondApprover,
  initialEmail,
  initialGroup,
  cancelHref,
  newGroupHref,
  grant,
}: {
  readonly workspaceId: string;
  readonly groups: readonly AccessGroup[];
  readonly people: readonly PersonRow[];
  readonly environments: readonly string[];
  readonly viewerEmail: string;
  readonly requireSecondApprover: boolean;
  readonly initialEmail: string;
  readonly initialGroup: string | undefined;
  readonly cancelHref: string;
  readonly newGroupHref: string;
  readonly grant: (
    workspaceId: string,
    teamId: string,
    email: string,
  ) => Promise<MembershipActionState>;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [teamId, setTeamId] = useState<string | null>(initialGroup ?? null);
  const [tried, setTried] = useState(false);
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const address = email.trim();
  const invalid = !looksLikeAddress(address);
  const group = groups.find((entry) => entry.teamId === teamId);
  const existing = people.find(
    (person) => person.email.toLocaleLowerCase() === address.toLocaleLowerCase(),
  );
  const self = address.toLocaleLowerCase() === viewerEmail.toLocaleLowerCase();
  const held =
    group !== undefined &&
    holdsForApproval({
      requireSecondApprover,
      actorInGroup: self,
      before: undefined,
      after: group,
    });
  const before = existing === undefined ? [] : liveGrants(existing);
  let submit = t("membership.grant.submit");
  if (held) submit = t("access.preview.requestApproval");
  if (pending) submit = t("membership.grant.working");

  return (
    <section aria-labelledby="qcms-grant-heading" className="flex min-w-0 flex-col gap-4">
      <div className="qcms-help-head">
        <h1 id="qcms-grant-heading" className="text-xl font-semibold text-(--color-text)">
          {t("membership.grant.heading")}
        </h1>
        <HelpTip label={t("membership.grant.heading")}>{t("membership.grant.intro")}</HelpTip>
      </div>

      <div aria-live="polite" className="flex min-w-0 flex-col gap-2">
        {state.status === "done" && <Alert variant="success">{state.message}</Alert>}
        {state.status === "held" && (
          <Alert variant="warning">
            <span className="qcms-tag qcms-tag--deprecated">
              {t("access.preview.needsApprover")}
            </span>{" "}
            {state.message}
          </Alert>
        )}
        {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      </div>

      {groups.length === 0 ? (
        <p className="text-sm">
          {t("membership.grant.noGroups")}{" "}
          <Link href={newGroupHref} className="qcms-text-link">
            {t("membership.groups.new")}
          </Link>
        </p>
      ) : (
        <form
          className="flex min-w-0 max-w-xl flex-col gap-4"
          data-testid="qcms-grant-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (invalid || group === undefined) return;
            startTransition(async () => {
              setState(await grant(workspaceId, group.teamId, address));
            });
          }}
        >
          <HeadingMarker control="membership.grant" block>
            <TextField
              label={t("membership.grant.email")}
              type="email"
              autoComplete="off"
              description={t("membership.grant.emailHint")}
              value={email}
              isInvalid={tried && invalid}
              errorMessage={t("membership.grant.emailInvalid")}
              onChange={setEmail}
            />
          </HeadingMarker>
          <Select
            label={t("membership.grant.group")}
            placeholder={t("membership.grant.groupChoose")}
            value={teamId}
            isInvalid={tried && group === undefined}
            errorMessage={t("membership.grant.groupMissing")}
            onChange={(value: string) => {
              setTeamId(value);
            }}
            items={groups.map((entry) => ({
              label: `${entry.name} - ${groupScope(entry)}`,
              value: entry.teamId,
            }))}
          />

          {group !== undefined && (
            <AccessPreview
              delta={accessDelta(before, [...before, grantOf(group)], environments)}
              approval={held ? { reason: t("membership.grant.selfApproval") } : undefined}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="md" isDisabled={pending}>
              {submit}
            </Button>
            <Link href={cancelHref} className="qcms-button-link qcms-button-link--secondary">
              {t("access.confirm.cancel")}
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}
