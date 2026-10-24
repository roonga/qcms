"use client";

import { MessageScreen } from "@/components/message-screen";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";

/**
 * The flow segment's error boundary.
 *
 * It does not catch a stale Server Action id: Next's action handler refuses an unknown
 * id before this segment renders, and no page this repository owns is consulted for
 * that response (ADR-43). Every cause that does reach here has the same remedy from the
 * respondent's side, which is to re-read the step, so one screen covers all of them.
 */
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
