"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { HelpTip } from "@/components/help-tip";
import { Alert } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { EMPTY_DRAFT, type GroupPayload } from "@/lib/membership/group-edit";
import type { MembershipActionState } from "@/lib/membership/types";

import { GroupForm } from "./group-form";

export function NewGroupPanel({
  workspaceId,
  environments,
  listHref,
  create,
}: {
  readonly workspaceId: string;
  readonly environments: readonly string[];
  readonly listHref: string;
  readonly create: (workspaceId: string, body: GroupPayload) => Promise<MembershipActionState>;
}) {
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  // A new form per created group, so the next one starts empty.
  const [round, setRound] = useState(0);

  return (
    <section
      aria-labelledby="qcms-new-group-heading"
      className="flex min-w-0 max-w-xl flex-col gap-4"
      data-testid="qcms-access-group-create"
    >
      <div className="qcms-help-head">
        <h1 id="qcms-new-group-heading" className="text-xl font-semibold text-(--color-text)">
          {t("membership.groups.new")}
        </h1>
        <HelpTip label={t("membership.groups.new")}>{t("membership.groups.intro")}</HelpTip>
      </div>
      <div aria-live="polite">
        {state.status === "held" && <Alert variant="warning">{state.message}</Alert>}
        {state.status === "done" && state.teamId !== undefined && (
          <Alert variant="success">
            {state.message}{" "}
            <Link
              href={`${listHref}?group=${encodeURIComponent(state.teamId)}`}
              className="qcms-text-link"
            >
              {t("membership.groups.openCreated")}
            </Link>
          </Alert>
        )}
      </div>
      <HeadingMarker control="membership.groupCreate" block>
        <GroupForm
          key={round}
          initial={EMPTY_DRAFT}
          environments={environments}
          viewerInGroup={false}
          requireSecondApprover={false}
          submitLabel={t("membership.groups.createSubmit")}
          pending={pending}
          error={state.status === "error" ? state.message : undefined}
          onSubmit={(payload) => {
            startTransition(async () => {
              const result = await create(workspaceId, payload);
              setState(result);
              if (result.status === "done") setRound((current) => current + 1);
            });
          }}
        />
      </HeadingMarker>
    </section>
  );
}
