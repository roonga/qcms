"use client";

import { t } from "@/lib/i18n/en";
import { selectSettingsPanel, useSettingsPanel } from "@/lib/settings-panel";
import type { SettingsSectionId } from "@/lib/settings-sections";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";

/**
 * The Settings section rail, rebuilt to its POC (issue 655).
 *
 * ## Read this before reaching for the shared rail, because the name of the other one is
 * misleading
 *
 * This is **not** the form-subtree rail on another screen. That rail carries navigation
 * between ROUTES. Settings is one route, so a rail here can only switch what the one route
 * is showing. What the two share is the grid column, the 240px width and the `--bp-sidebar`
 * collapse behaviour, and those three live in `app/globals.css` as the `qcms-rail*` geometry
 * classes, which know nothing about what a rail carries.
 *
 * **`components/rail-frame.tsx` is not widened for this, and no abstraction is shared with
 * `components/forms/form-subtree-rail.tsx`.** There is no base component, no widened props
 * type, no variant flag and no common module between them. Two things stayed local rather
 * than being pushed into the shared file, and both are named here so a reader does not have
 * to diff to find them: the twelve lines of `<details>` chrome below are restated rather
 * than taken from `RailFrame`, and the panel switch is this component's own.
 *
 * ## What it carries: three buttons that switch a panel, and nothing else
 *
 * `plan/admin-shell-poc/settings-newquestion-poc.html` draws every row as
 * `<button onclick="showSettingsPanel(...)">`, moves `aria-current="page"` onto the row that
 * was pressed, shows that section's panel and hides the other two. That is the approved
 * design and it is what this renders. **It requires JavaScript and there is no fallback.**
 * `docs/admin-constraints.md` is explicit on both halves of that: the POCs are the design,
 * and "JavaScript is available and a design may depend on it". Issue 655 exists because this
 * screen was built as though a no-script floor bound it.
 *
 * The rows are buttons rather than anchors for the reason the same document gives: "an anchor
 * navigates, a button acts", and a section here is not a destination. It is a switch on the
 * screen the reader is already standing on, so there is nothing to open in a new tab, and a
 * `next/link` would re-render the screen under a half-typed password field.
 *
 * ## The active row, and why the mark is not colour alone
 *
 * `aria-current="page"` is the whole of the accessible statement, set by React from the same
 * value the panel and the heading render from, so the three can never disagree. A screen
 * reader hears it on the row it just activated, because the attribute changes on the element
 * that has focus.
 *
 * Visually the mark is a tint, an accent edge and a heavier weight (`app/globals.css`), so it
 * survives high contrast where the tint collapses into the surface and it never rests on
 * colour alone. WCAG 2.2 AA is an aim rather than a gate here (`docs/admin-constraints.md`),
 * and this is the cheap end of it: the POC draws the mark this way regardless.
 *
 * ## The summary says "Settings"
 *
 * The POC's own wording. Below `--bp-sidebar` the rail collapses to this one line, and the
 * screen it belongs to is what a reader needs named there. It no longer names the active
 * section: the `<h1>` beside it does that now, which is the POC's other reason for moving
 * the heading off the screen's name and onto the section's.
 */
export function SettingsSectionRail({ initial }: { readonly initial: SettingsSectionId }) {
  const selected = useSettingsPanel(initial);

  return (
    <nav
      className="qcms-rail qcms-settings-rail"
      aria-label={t("settings.rail.label")}
      data-testid="qcms-settings-rail"
    >
      {/* A native `<details open>` at every width, for the reasons `components/rail-frame.tsx`
          writes out at length: an element cannot be chosen by media query, a second copy of
          the navigation would be a second set of rows to walk, and the browser announces
          expanded and collapsed itself more reliably than any `aria-expanded` written by
          hand. Above `--bp-sidebar` the chevron goes and the summary stops advertising
          itself as a control; it remains one. */}
      <details className="qcms-rail__disclosure" open>
        <summary className="qcms-rail__summary">
          {/* The screen's own name, which is `settings.title` rather than a second string
              saying the same word: the summary IS the screen's name here, and a catalog with
              two entries for "Settings" is two entries a translator can disagree with. */}
          <span className="qcms-rail__summary-text">{t("settings.title")}</span>
          <span className="qcms-rail__chevron" aria-hidden="true">
            {"›"}
          </span>
        </summary>
        <div className="qcms-rail__body">
          {/* One group, so no divider and no group label: the shared rail's divider separates
              two groups and there is nothing here to separate, and a name on this list would
              only repeat the name the `<nav>` already carries. An unordered list, because the
              sections have a reading order but no ordinal an operator would ever cite. */}
          <ul className="qcms-rail__group">
            {SETTINGS_SECTIONS.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  className="qcms-rail__link qcms-settings-rail__link"
                  id={`rail-${section.panelId}`}
                  aria-controls={section.panelId}
                  aria-current={section.id === selected ? "page" : undefined}
                  data-settings-rail-item={section.id}
                  onClick={() => {
                    selectSettingsPanel(section.id);
                  }}
                >
                  {t(section.labelKey)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </nav>
  );
}
