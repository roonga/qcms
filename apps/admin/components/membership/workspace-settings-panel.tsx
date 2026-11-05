"use client";

import { useState, useTransition } from "react";

import { Alert, Button, Checkbox } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";
import type { MembershipActionState, WorkspaceSettings } from "@/lib/membership/types";

/* Show the personal-data warning before the setting changes: test responses can contain real respondents'
   data too. */
export function WorkspaceSettingsPanel({
  settings,
  save,
}: {
  readonly settings: WorkspaceSettings;
  readonly save: (
    workspaceId: string,
    next: {
      readonly requireSecondApprover: boolean;
      readonly seedNewEditorsWithTestData: boolean;
    },
  ) => Promise<MembershipActionState>;
}) {
  const [twoPerson, setTwoPerson] = useState(settings.requireSecondApprover);
  const [seed, setSeed] = useState(settings.seedNewEditorsWithTestData);
  const [state, setState] = useState<MembershipActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  return (
    <section
      aria-labelledby="qcms-workspace-settings-heading"
      className="flex min-w-0 flex-col gap-3"
    >
      <h1
        id="qcms-workspace-settings-heading"
        className="text-xl font-semibold text-(--color-text)"
      >
        {t("membership.settings.heading")}
      </h1>

      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "done" && <Alert variant="success">{state.message}</Alert>}

      <HeadingMarker control="membership.workspaceSettings" block>
        <div className="flex flex-col gap-2">
          <Checkbox
            label={t("membership.settings.twoPerson")}
            isSelected={twoPerson}
            onChange={setTwoPerson}
          />
          <p id="qcms-two-person-help" className="text-xs text-(--color-text-muted)">
            {t("membership.settings.twoPersonHelp")}
          </p>
        </div>
      </HeadingMarker>

      <div className="flex flex-col gap-2">
        <Checkbox label={t("membership.settings.seed")} isSelected={seed} onChange={setSeed} />
        <p id="qcms-seed-help" className="text-xs text-(--color-text-muted)">
          {t("membership.settings.seedHelp")}
        </p>
      </div>

      <div>
        <Button
          isDisabled={pending}
          onPress={() => {
            startTransition(async () => {
              setState(
                await save(settings.workspaceId, {
                  requireSecondApprover: twoPerson,
                  seedNewEditorsWithTestData: seed,
                }),
              );
            });
          }}
        >
          {t("membership.settings.save")}
        </Button>
      </div>
    </section>
  );
}
