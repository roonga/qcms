"use client";

import { Alert } from "@/components/kit";
import type { UnsaveableReason } from "@/lib/forms/draft";
import { t, type MessageKey } from "@/lib/i18n/en";

export function SaveNotices({
  paused,
  saveError,
}: {
  readonly paused: UnsaveableReason | undefined;
  readonly saveError: string | undefined;
}) {
  if (paused === undefined && saveError === undefined) return null;
  return (
    <div className="flex flex-col gap-2">
      {paused !== undefined && (
        <div data-testid="qcms-autosave-paused" data-paused-reason={paused}>
          <Alert variant="warning">{t(PAUSE_MESSAGES[paused])}</Alert>
        </div>
      )}
      {saveError !== undefined && (
        <Alert variant="error">{t("forms.builder.saveFailed", { message: saveError })}</Alert>
      )}
    </div>
  );
}

const PAUSE_MESSAGES: Readonly<Record<UnsaveableReason, MessageKey>> = {
  noSteps: "forms.save.pausedNoSteps",
  emptyStep: "forms.save.pausedEmptyStep",
  emptyGroup: "forms.save.pausedEmptyGroup",
  ruleWithoutTarget: "forms.save.pausedNoTarget",
};
