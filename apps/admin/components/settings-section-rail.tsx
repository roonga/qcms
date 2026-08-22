import { t } from "@/lib/i18n/en";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";

/**
 * The Settings section rail (`plan/admin-design-contracts.md` §7a, issue 562).
 *
 * ## Read §7a before touching this, because the name of the other one is misleading
 *
 * This is **not** the form-subtree rail on another screen. §7's rail carries navigation
 * between ROUTES and explicitly never carries a same-page section switch. Settings is one
 * route, so a rail here can only carry same-page section switches - precisely the thing §7
 * forbids. That is why §7a is written as an exception rather than as an application, and
 * why this is a second, narrower component that happens to occupy the same grid column.
 *
 * What the two share, in the ruling's own words, is "the grid column, the 240px width, the
 * `--bp-sidebar` collapse behaviour and the anchors-not-buttons rule - and nothing else".
 * Those four live in `app/globals.css` as the `qcms-rail*` geometry classes, which know
 * nothing about what a rail carries. Everything else here is this component's own.
 *
 * **No abstraction is shared with `components/forms/form-subtree-rail.tsx`, deliberately.**
 * There is no base component, no widened props type, no variant flag and no common module
 * between them. `components/rail-frame.tsx` holds exactly the shared four and nothing else,
 * and it is left exactly as issue 559 built it. The one thing this file wanted from it and
 * did not take is explained under "Why the disclosure is re-typed here" below.
 *
 * ## What it carries: three fragment anchors, and nothing else
 *
 * No routes, no actions, no counts. Every row is a bare `<a href="#section">`, not a
 * `next/link`: a fragment on the current route is the browser's own navigation, and routing
 * it through the App Router would turn an in-page jump into a re-render of the screen the
 * reader is standing on - which would, among other things, empty a half-typed password
 * field. That difference is also a fair summary of why these are two components: §7's rows
 * are routes and use `next/link`; these are fragments and must not.
 *
 * Anchors rather than buttons is a no-JavaScript and open-in-a-new-tab requirement, not a
 * styling preference, and there is not a `<button>` in this file. The test beside it asserts
 * that by counting rather than by reading.
 *
 * ## The active section is the fragment in the URL, and it does not follow the scroll
 *
 * §7 never had to answer this: on a form-subtree screen the active item is the route you
 * are on, and the server knows it. A fragment is never sent to the server, so the active
 * section is settled in the stylesheet with `:target` (`app/globals.css`, the §7a block),
 * which is the platform's own answer to "which fragment is current" and costs no script.
 *
 * It deliberately does **not** update as the reader scrolls. A scroll spy would need client
 * JavaScript on a screen that ships none, would leave the no-JavaScript reader with a rail
 * that names nothing, and - the real objection - would assert a current section the reader
 * never chose. The fragment is a choice: clicked here, bookmarked, or arrived at from the
 * account menu's Change password item. Before any choice is made there is no active section,
 * and the summary says so with its own name rather than guessing at the topmost one.
 *
 * The mark is not colour alone (WCAG 2.2 AA, SC 1.4.1): the accent edge and heavier weight
 * are joined by a visually-hidden "Current section" phrase inside the active row. It is
 * `display: none` until the row matches, so it is out of the accessibility tree rather than
 * merely invisible, and exactly one row ever announces it. That phrase is what replaces the
 * `aria-current` §7's rail sets, which a stylesheet cannot set.
 *
 * ## Why the disclosure is re-typed here rather than taken from `RailFrame`
 *
 * `RailFrame` takes its summary as a `string`. This summary cannot be one: it holds one
 * name per section plus a fallback, of which CSS reveals exactly the one the URL names, so
 * it is markup rather than text. Widening `RailFrame`'s prop to a `ReactNode` to fit this
 * would be adding to the shared four to make Settings work, which is the move §7a's
 * condition exists to prevent - the shared file would stop being "the chrome and only the
 * chrome" and become the seam the two contracts get unified along. So the twelve lines of
 * `<details>` chrome are restated here, against the same stylesheet classes, and
 * `components/rail-frame.tsx` is untouched by this change.
 *
 * A server component, and it needs to be nothing else. Nothing here ships to the client,
 * nothing waits for hydration, and the whole rail - the disclosure, the anchors and the
 * active mark - works with JavaScript disabled.
 */
export function SettingsSectionRail() {
  return (
    <nav
      className="qcms-rail qcms-settings-rail"
      aria-label={t("settings.rail.label")}
      data-testid="qcms-settings-rail"
    >
      {/* A native `<details open>` at every width, for the reasons `components/rail-frame.tsx`
          writes out at length: an element cannot be chosen by media query, a second copy of
          the navigation would be a second set of links to walk, and the browser announces
          expanded and collapsed itself more reliably than any `aria-expanded` written by
          hand. Above `--bp-sidebar` the chevron goes and the summary stops advertising
          itself as a control; it remains one. */}
      <details className="qcms-rail__disclosure" open>
        <summary className="qcms-rail__summary">
          <span className="qcms-rail__summary-text">
            {/* All four names are in the DOM and CSS reveals one. `display: none` takes the
                other three out of the accessibility tree rather than hiding them visually,
                so a screen reader on the collapsed rail hears exactly one section named -
                the one the URL names, or this fallback when it names none. */}
            <span className="qcms-settings-rail__summary-name" data-settings-summary="">
              {t("settings.rail.summaryDefault")}
            </span>
            {SETTINGS_SECTIONS.map((section) => (
              <span
                key={section.id}
                className="qcms-settings-rail__summary-name"
                data-settings-summary={section.id}
              >
                {t(section.labelKey)}
              </span>
            ))}
          </span>
          <span className="qcms-rail__chevron" aria-hidden="true">
            {"›"}
          </span>
        </summary>
        <div className="qcms-rail__body">
          {/* One group, so no divider and no group label: §7's divider separates two groups
              and there is nothing here to separate, and a name on this list would only
              repeat the name the `<nav>` already carries. An unordered list, because the
              sections have a document order but no ordinal an operator would ever cite -
              there is no "step 2" here to number. */}
          <ul className="qcms-rail__group">
            {SETTINGS_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  className="qcms-rail__link qcms-settings-rail__link"
                  href={`#${section.id}`}
                  data-settings-rail-item={section.id}
                >
                  <span>{t(section.labelKey)}</span>
                  <span className="qcms-settings-rail__current qcms-visually-hidden">
                    {t("settings.rail.current")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </nav>
  );
}
