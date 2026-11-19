"use client";

import { useState, useTransition } from "react";

import { Alert, Button, RadioButton, RadioField, RadioGroup } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { NO_LIBRARY } from "@/lib/membership/site";

import type { LibraryState, SharedLibraryChoice } from "@/app/(shell)/site/shared-library/actions";

export interface LibraryWorkspace {
  readonly workspaceId: string;
  readonly name: string;
}

/**
 * One chooser, then the confirmation that states who will see the library's questions. The
 * marking is a site act, audited at site level and mirrored into that workspace's audit.
 */
export function SharedLibraryPanel({
  workspaces,
  holder,
  save,
}: {
  readonly workspaces: readonly LibraryWorkspace[];
  readonly holder: string | null;
  readonly save: (next: SharedLibraryChoice) => Promise<LibraryState>;
}) {
  const [chosen, setChosen] = useState(holder ?? NO_LIBRARY);
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<LibraryState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const next = chosen === NO_LIBRARY ? null : chosen;
  const chosenName = workspaces.find((workspace) => workspace.workspaceId === next)?.name ?? "";
  const changed = next !== holder;

  return (
    <section className="flex min-w-0 flex-col gap-4" data-testid="qcms-shared-library">
      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "done" && <Alert variant="success">{state.message}</Alert>}
      {workspaces.length < 2 && (
        <p className="text-sm text-(--color-text-muted)">{t("site.library.oneWorkspace")}</p>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-semibold text-(--color-text)">
          {t("site.library.choose")}
        </legend>
        <p className="text-sm text-(--color-text-muted)">{t("site.library.archivedNote")}</p>
        <RadioGroup
          className="flex flex-col gap-2"
          aria-label={t("site.library.choose")}
          value={chosen}
          onChange={(value) => {
            setChosen(value);
            setConfirming(false);
            setState({ status: "idle" });
          }}
        >
          {[{ workspaceId: NO_LIBRARY, name: t("site.library.none") }, ...workspaces].map(
            (choice) => (
              <RadioField key={choice.workspaceId} value={choice.workspaceId}>
                <RadioButton className="qcms-radio">
                  <span className="qcms-radio__dot" aria-hidden="true" />
                  <span>{choice.name}</span>
                </RadioButton>
              </RadioField>
            ),
          )}
        </RadioGroup>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button
          isDisabled={!changed || pending}
          onPress={() => {
            setConfirming(true);
          }}
        >
          {t("site.library.save")}
        </Button>
      </div>

      {confirming && changed && (
        <div
          className="flex min-w-0 flex-col gap-2 rounded-(--radius-card) border border-(--color-border) px-4 py-3"
          data-testid="qcms-shared-library-confirm"
        >
          <p className="text-sm">
            {next === null
              ? t("site.library.confirmUnmark")
              : t("site.library.confirmMark", { workspace: chosenName })}
          </p>
          {next !== null && (
            <p className="text-sm text-(--color-text-muted)">
              {t("site.library.recorded", { workspace: chosenName })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              isDisabled={pending}
              onPress={() => {
                startTransition(async () => {
                  setState(await save({ workspaceId: next, holder }));
                  setConfirming(false);
                });
              }}
            >
              {t("site.library.save")}
            </Button>
            <Button
              variant="secondary"
              isDisabled={pending}
              onPress={() => {
                setConfirming(false);
              }}
            >
              {t("access.confirm.cancel")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
