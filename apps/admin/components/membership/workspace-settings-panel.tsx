"use client";

import { useState, useTransition } from "react";

import { Alert, Button, Checkbox } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import type { MembershipActionState, WorkspaceSettings } from "@/lib/membership/types";

/**
 * The two per-workspace switches (Q13, Q30, Q51, Q56, Q57; task 069).
 *
 * # One string on this panel is a control rather than copy
 *
 * `membership.settings.seedHelp` is the **help text Q57 asks for by name**: this record,
 * the plan and the admin's help text say in those terms that a grant on `test` responses
 * is a grant on **personal data**, because a test run can involve real respondents. It is
 * rendered beside the switch, unconditionally and whether or not the switch is on, because
 * a warning that appeared only after somebody turned it on would arrive after the
 * decision. `apps/admin/e2e/membership.pw.ts` asserts it is on screen, because a warning
 * nobody renders is the failure mode.
 *
 * # The other switch is one switch with three effects, and the help text says so
 *
 * `requireSecondApprover` governs the two-person rule for a production release and a
 * production endpoint change (task 070's), **and** the self-grant rule here (Q56): nobody
 * can grant themselves a `responses.*` role while it is on. An installation turns on one
 * thing and gets the whole two-person posture, and an operator reading one switch should
 * be told all three effects rather than discovering the third when a grant is refused.
 *
 * # Why this is a client component
 *
 * Two checkboxes whose change has to be confirmed before it is sent: turning either of
 * these on is a deliberate act and is written to the audit, so a switch that saved on
 * every keystroke would put a row in the audit for a change nobody finished making.
 */
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
      <h2
        id="qcms-workspace-settings-heading"
        className="text-lg font-semibold text-(--color-text)"
      >
        {t("membership.settings.heading")}
      </h2>

      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "done" && <Alert variant="success">{state.message}</Alert>}

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

      <div className="flex flex-col gap-2">
        <Checkbox label={t("membership.settings.seed")} isSelected={seed} onChange={setSeed} />
        {/*
         * Q57's sentence. Rendered always, and before the switch is touched: a grant on
         * test responses is a grant on personal data, and an operator reads that while
         * deciding rather than afterwards.
         */}
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
