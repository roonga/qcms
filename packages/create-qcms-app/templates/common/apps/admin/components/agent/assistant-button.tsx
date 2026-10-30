"use client";

import { AssistMark } from "@/components/forms/assist-mark";
import { t } from "@/lib/i18n/en";
import { ASSISTANT_BUTTON_ID, PANEL_ID } from "@/lib/agent/panel";

/**
 * The assistant's entry: a 32 CSS px button in the top bar's trailing group, before the
 * account avatar (issue #1133). There is no floating launcher.
 *
 * With the flag off the component is not rendered at all, which is the stance the builder
 * prop took: absent rather than hidden. Its badge is short text immediately after it, so a
 * running turn is never signalled by colour or motion alone (ruling O3).
 */
export function AssistantButton({
  open,
  working,
  onPress,
}: {
  readonly open: boolean;
  readonly working: boolean;
  readonly onPress: () => void;
}) {
  return (
    <div className="qcms-assistant-entry">
      <button
        id={ASSISTANT_BUTTON_ID}
        type="button"
        className="qcms-assistant-trigger"
        data-testid="qcms-assistant-button"
        aria-label={t("agent.open")}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        title={t("agent.open.tooltip")}
        onClick={onPress}
      >
        <AssistMark size={24} working={working} />
      </button>
      {working && (
        <span className="qcms-tag" data-testid="qcms-assistant-badge">
          {t("agent.working")}
        </span>
      )}
    </div>
  );
}
