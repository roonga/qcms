"use client";

import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { useSettingsPanel } from "@/lib/settings-panel";
import type { SettingsSectionId } from "@/lib/settings-sections";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";

/**
 * The Settings screen's parts of the one rail (`plan/admin-design-contracts.md` §7.0,
 * issues 655 and #1116).
 *
 * ## It was a separate rail "named distinctly so no future reader can unify them"
 *
 * That was §7a's condition for Settings keeping a rail at all, and this file used to restate
 * the frame's chrome rather than share it, for exactly that reason. §7.0 retires the
 * condition along with the premise behind it: there is one rail, it belongs to the page, and
 * it looks and behaves the same everywhere. So the twelve lines of `<details>` chrome are
 * gone and this is the parts `components/rail-frame.tsx` takes.
 *
 * - **Header:** "Settings", and no back link. Settings is a top-level screen, which is the
 *   one row of §7.0's table whose Header has nothing to go back to.
 * - **Sections:** the three panels, as anchors.
 *
 * There are no children, no filters and no actions on this screen.
 *
 * ## The rows are anchors now, and the fragment is the address
 *
 * They were `<button onclick="showSettingsPanel(...)">`, which is what
 * `plan/admin-shell-poc/settings-newquestion-poc.html` draws, on the rule that an anchor
 * navigates and a button acts. §7.0 ruling 2.2 settles it the other way for a rail row:
 * "anchors to the subject's routes or same-page panels ... Never buttons". One rail with one
 * kind of row is the point.
 *
 * `#change-password` was already this screen's published address -
 * `components/account-menu.tsx` has linked to `/settings#change-password` since task 032 -
 * so the rows link to the section ids that link already uses, and
 * `components/settings-panels.tsx` reads the fragment and switches the panel. The URL
 * contract is unchanged and the three sections are reachable by one mechanism rather than
 * two; what is gained is that every row is a link an operator can copy.
 *
 * **JavaScript is required and that is settled** (standing correction, 2026-08-22, and the
 * 2026-09-27 ruling that the admin requires it). The fragment is read in the browser, which
 * is the only place a fragment can be read.
 *
 * ## The active row, and why the mark is not colour alone
 *
 * `aria-current="page"` is the whole of the accessible statement, set by React from the same
 * value the panel and the heading render from, so the three can never disagree. A screen
 * reader hears it on the row it just activated, because the attribute changes on the element
 * that has focus.
 *
 * Visually the mark is the rail's one current mark - a tint, a 2px accent edge and weight
 * 700 (`app/globals.css`) - so it survives high contrast where the tint collapses into the
 * surface and it never rests on colour alone. The Settings-only copy of those declarations
 * went with §7.0: one rule marks the current row in every rail, which is what "exactly one
 * row reads as selected" needs in order to be checkable.
 */
export function SettingsSectionRail({ initial }: { readonly initial: SettingsSectionId }) {
  const selected = useSettingsPanel(initial);

  return (
    <RailFrame
      // The screen's own name, which is `settings.title` rather than a second string saying
      // the same word: the Header IS the screen's name here, and a catalog with two entries
      // for "Settings" is two entries a translator can disagree with.
      subject={t("settings.title")}
      title={t("settings.title")}
      testId="qcms-settings-rail"
      sections={
        /* One group, so no divider and no group label of its own: a name on this list would
           only repeat the name the `<nav>` around it already carries. An unordered list,
           because the sections have a reading order but no ordinal an operator would cite. */
        <ul className="qcms-rail__group" data-rail-group="sections">
          {SETTINGS_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="qcms-rail__link"
                id={`rail-${section.panelId}`}
                aria-controls={section.panelId}
                aria-current={section.id === selected ? "page" : undefined}
                data-rail-item={`section:${section.id}`}
                data-settings-rail-item={section.id}
              >
                {t(section.labelKey)}
              </a>
            </li>
          ))}
        </ul>
      }
    />
  );
}
