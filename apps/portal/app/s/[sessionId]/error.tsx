"use client";

import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";

export default function FlowError() {
  return (
    <MessageScreen
      tone="neutral"
      title={t("repeat.staleStep.title")}
      body={t("repeat.staleStep.body")}
    >
      {/* A plain anchor, not a button: the respondent this screen exists for has no
          JavaScript and a boundary's `reset()` needs it. */}
      <a href="." className={buttonClass("primary")} data-testid="stale-step-continue">
        {t("action.continue")}
      </a>
    </MessageScreen>
  );
}
