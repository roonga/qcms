"use client";

import { useState, useTransition } from "react";

import { useAppLocale } from "@/components/locale-context";
import { Alert, Button, Select } from "@/components/kit";
import {
  describeMovedPerson,
  type MoveDestination,
  type MovePreview,
  type MovePreviewPerson,
} from "@/lib/forms/move";
import { t, tPlural } from "@/lib/i18n/en";

import type { MoveState } from "@/app/(shell)/forms/[formId]/move/actions";

/**
 * The chooser, the preview the API answered for the chosen destination, and the act. The
 * button reads Request move where the source workspace holds the move for an approver.
 */
export function MoveFormPanel({
  formId,
  source,
  destinations,
  chosen,
  preview,
  error,
  move,
}: {
  readonly formId: string;
  readonly source: string;
  readonly destinations: readonly MoveDestination[];
  readonly chosen?: MoveDestination;
  readonly preview?: MovePreview;
  readonly error?: string;
  readonly move: (formId: string, destination: MoveDestination) => Promise<MoveState>;
}) {
  const [state, setState] = useState<MoveState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const locale = useAppLocale();

  if (destinations.length === 0) {
    return (
      <section className="flex min-w-0 flex-col gap-3" data-testid="qcms-move-form">
        <p className="text-sm">{t("forms.move.nowhere")}</p>
      </section>
    );
  }

  const held = preview?.requiresApproval === true;

  return (
    <section className="flex min-w-0 flex-col gap-4" data-testid="qcms-move-form">
      <form method="get" className="flex min-w-0 flex-col gap-2">
        <Select
          name="to"
          label={t("forms.move.destination")}
          description={t("forms.move.destinationHelp")}
          items={destinations.map((destination) => ({
            value: destination.workspaceId,
            label: destination.name,
          }))}
          {...(chosen === undefined ? {} : { defaultValue: chosen.workspaceId })}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" size="md">
            {t("forms.move.preview")}
          </Button>
        </div>
      </form>

      {error !== undefined && <Alert variant="error">{error}</Alert>}
      {state.status === "error" && <Alert variant="error">{state.message}</Alert>}
      {state.status === "moved" && <Alert variant="success">{state.message}</Alert>}
      {state.status === "held" && <Alert variant="warning">{state.message}</Alert>}

      {chosen === undefined || preview === undefined ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.move.choose")}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3" data-testid="qcms-move-preview">
          <p className="text-sm">{t("forms.move.summary", { source, destination: chosen.name })}</p>
          <p className="text-sm" data-testid="qcms-move-appearance">
            {t("forms.move.appearance", { destination: chosen.name })}
          </p>
          <People
            label={tPlural("forms.move.gainsOne", "forms.move.gains", preview.gains.length)}
            people={preview.gains}
            locale={locale}
            testId="qcms-move-gains"
          />
          <People
            label={tPlural("forms.move.losesOne", "forms.move.loses", preview.losses.length)}
            people={preview.losses}
            locale={locale}
            testId="qcms-move-losses"
          />
          {preview.gains.length + preview.losses.length === 0 && (
            <p className="text-sm">{t("forms.move.noChange")}</p>
          )}
          {held && (
            <div className="flex flex-wrap items-center gap-2" data-testid="qcms-move-approval">
              <span className="qcms-tag qcms-tag--deprecated">
                {t("access.preview.needsApprover")}
              </span>
              <span className="text-sm">
                {t(
                  preview.holdReason === "second-approval"
                    ? "forms.move.heldBySetting"
                    : "forms.move.heldByRole",
                  { source },
                )}
              </span>
              <span className="text-sm text-(--color-text-muted)">
                {t("access.preview.approvers", {
                  approvers: t("forms.move.approvers", { source }),
                })}
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              isDisabled={pending || state.status === "moved" || state.status === "held"}
              onPress={() => {
                startTransition(async () => {
                  setState(await move(formId, chosen));
                });
              }}
            >
              {held
                ? t("forms.move.request")
                : t("forms.move.confirm", { destination: chosen.name })}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function People({
  label,
  people,
  locale,
  testId,
}: {
  readonly label: string;
  readonly people: readonly MovePreviewPerson[];
  readonly locale: string;
  readonly testId: string;
}) {
  if (people.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1 rounded-(--radius-card) border border-(--color-border) px-4 py-3"
      data-testid={testId}
    >
      <p className="text-xs font-semibold tracking-wide text-(--color-text-muted) uppercase">
        {label}
      </p>
      <ul className="text-sm">
        {people.map((person, index) => (
          <li key={`${String(index)}-${person.name}`}>{describeMovedPerson(person, locale)}</li>
        ))}
      </ul>
    </div>
  );
}
