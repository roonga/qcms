"use client";

import { AssistMark } from "@/components/forms/assist-mark";
import { AssistTip, useAssistTip } from "@/components/forms/assist-tip";
import { t } from "@/lib/i18n/en";
import { ASSISTANT_BUTTON_ID, PANEL_ID } from "@/lib/agent/panel";

/**
 * The assistant's entry: a 32 CSS px button in the top bar's trailing group, before the
 * account avatar.
 *
 * Its badge is short text immediately after it, so a running turn is never signalled by
 * colour or motion alone. Its tooltip prints the keyboard shortcut and is the panel's own
 * dismissible, hoverable and persistent one rather than a native `title`, which satisfies
 * none of those (WCAG 2.2 SC 1.4.13).
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
  const tip = useAssistTip();

  return (
    <div className="qcms-assistant-entry">
      <span className="qcms-assist-iconbtn" {...tip.hover}>
        <button
          id={ASSISTANT_BUTTON_ID}
          type="button"
          className="qcms-assistant-trigger"
          data-testid="qcms-assistant-button"
          aria-label={t("agent.open")}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          onClick={onPress}
          {...tip.control}
        >
          <AssistMark size={24} working={working} />
        </button>
        {tip.open && <AssistTip text={t("agent.open.tooltip")} />}
      </span>
      {working && (
        <span className="qcms-tag" data-testid="qcms-assistant-badge">
          {t("agent.working")}
        </span>
      )}
    </div>
  );
}
