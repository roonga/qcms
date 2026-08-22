"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";
import { resetSettingsPanel, selectSettingsPanel, useSettingsPanel } from "@/lib/settings-panel";
import type { SettingsSectionId } from "@/lib/settings-sections";
import {
  SETTINGS_HEADING_ID,
  SETTINGS_SECTIONS,
  settingsSectionFromHash,
  settingsSectionLabelKey,
} from "@/lib/settings-sections";

/**
 * The Settings screen's three panels and the heading that names the showing one (issue 655).
 *
 * ## One panel, not three stacked cards
 *
 * `plan/admin-shell-poc/settings-newquestion-poc.html` gives its reason in a comment: account,
 * change password and two-factor authentication are "three genuinely separate surfaces, and
 * stacking all three in one scroll was hiding that". So the two panels that are not showing
 * carry `hidden` - out of the layout and out of the accessibility tree, not merely scrolled
 * past - and the rail is the only way between them.
 *
 * **This requires JavaScript and adds no fallback.** The POC switches panels with a script and
 * that is the approved design; `docs/admin-constraints.md` states plainly that JavaScript is
 * available here and that a design may depend on it.
 *
 * ## The heading names the section, not the screen
 *
 * The POC's reason, in its own comment: "Settings" already lives in the rail summary and the
 * topbar, so a third copy above the panel says nothing, while the section's name is the one
 * fact the panel does not otherwise carry. Every panel is named BY this heading through
 * `aria-labelledby`, so the region a screen reader lands in is called whatever the heading
 * currently says and the two cannot drift.
 *
 * The heading's text changing under an unmoved focus is deliberate and it is not silent: the
 * reader pressed a rail button, and that button gains `aria-current="page"` while it still
 * has focus, which is a state change on the focused element and is announced as one. Focus
 * is not moved into the panel, because nothing was navigated to - the reader is on the screen
 * they were already on, and the next Tab from the rail continues into the panel they chose.
 *
 * ## Why the panels arrive as props
 *
 * Their contents are server-rendered: the account line reads the session, the two forms post
 * to route handlers, and the two-factor panel renders differently for an enrolled account.
 * None of that belongs in the client bundle. A server component can pass rendered children
 * into a client one, so the page composes all three and this component only decides which is
 * on screen.
 *
 * ## Why a URL fragment still selects a panel
 *
 * `components/account-menu.tsx` has linked to `/settings#change-password` since task 032 and
 * that link is part of that control's contract. A fragment is never sent to a server, so the
 * server cannot open on it; this reads it once after the first paint. Under the stacked
 * screen the fragment scrolled and under the panel screen it selects, and the URL contract is
 * unchanged either way. The query markers a POST redirects with are handled where they can
 * be, on the server, in `settingsSectionFromParams`.
 */
export function SettingsPanels({
  initial,
  panels,
}: {
  /** The section the URL asked for, decided on the server so the first HTML is already right. */
  readonly initial: SettingsSectionId;
  /** Each section's server-rendered body, keyed by the section it belongs to. */
  readonly panels: Readonly<Record<SettingsSectionId, ReactNode>>;
}) {
  const selected = useSettingsPanel(initial);

  useEffect(() => {
    const fromHash = settingsSectionFromHash(globalThis.location.hash);
    if (fromHash !== undefined) selectSettingsPanel(fromHash);
    // Module state outlives this route, so a choice made here must not follow the reader to
    // their next visit and hide the panel that visit's URL asked for.
    return resetSettingsPanel;
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 id={SETTINGS_HEADING_ID} className="text-xl font-semibold text-(--color-text)">
        {t(settingsSectionLabelKey(selected))}
      </h1>
      {SETTINGS_SECTIONS.map((section) => (
        <div
          key={section.id}
          id={section.panelId}
          className="qcms-settings-panel"
          hidden={section.id !== selected}
        >
          {panels[section.id]}
        </div>
      ))}
    </div>
  );
}
