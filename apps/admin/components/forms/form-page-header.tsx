import { t } from "@/lib/i18n/en";
import { sectionHeadingId } from "@/lib/page-headings";

/**
 * The chrome every form section shares: the screen's heading and the form's identity line
 * (034; 035 adds the responses and webhooks sections).
 *
 * ## The breadcrumb left this header for the rail's Header (§7.0 ruling 3, issue #1116)
 *
 * **The `slug` prop went with it.** The trail was the only thing on this header that named
 * the form: the heading names the section and the identity line below it names the form's
 * id and status. The form's NAME is the rail Header's now, on every one of these screens,
 * so a prop restored here would be a second place for it to be read from.
 *
 * It was "Forms / kitchen-sink / Links", the first line of every form section's column.
 * §7.0 makes the way back the rail Header's own back link - "the Header's back link ...
 * replaces the content-column breadcrumb on every screen" - and the rail states the form's
 * name and status one row above it, so the trail was three facts the rail already carried,
 * said again in the column beside it.
 *
 * **The default heading became visible with that change, and that is a consequence rather
 * than a second decision.** It was `qcms-visually-hidden` on the Code Owner's ruling of
 * 2026-08-26, whose whole reason was that "Links" directly under "Forms / kitchen-sink /
 * Links" told a sighted reader something they had just read. With the breadcrumb gone it is
 * the only thing naming the screen, so hiding it would leave five sibling screens with no
 * visible name at all.
 *
 * A server component, and since issue 561 an entirely static one. Keeping it in one place
 * is what stops the preview, version history, links, responses and webhooks screens
 * drifting into five slightly different headings for the same form.
 *
 * ## The section nav left this header for the rail (issue 561)
 *
 * It used to end with `FormTabs`, a `<nav>` of the same six routes
 * `plan/admin-design-contracts.md` §7 gives the rail. All eight form-scoped screens now
 * carry that rail (`app/(shell)/@rail/forms/[formId]/`), and one screen does not offer an
 * operator two navigations to the same six places, or give a screen reader two `nav`
 * landmarks saying the same thing. Issue 559 held the difference in a `sectionsInRail`
 * flag while one screen had a rail and seven did not; with every screen wired the flag had
 * exactly one value, and `form-tabs.tsx` had no caller left, so both went.
 *
 * ## The heading names the page, so it names the section (issue 679)
 *
 * The default `<h1>` is the section's own name, `forms.tab.{section}` - the same key the
 * tab strip reads, so the tab and the heading can never disagree. Five distinct headings
 * is what 679 asked for, and "Links", "Preview", "Version history", "Responses" and
 * "Webhooks" are five distinct headings.
 *
 * This paragraph used to say the heading composed the section's name with the form's slug
 * through a `forms.section.heading` template, citing the drawings that head their screens
 * "Draft preview: Life insurance". Both halves are gone: the Code Owner's amendment of
 * 2026-08-26 heads all six screens with the section name alone, because the rail carries
 * the form already and composing it here said the same word twice,
 * and the key itself was deleted by issue #538's dead-key sweep. The deviation from the
 * drawing and the reasoning for it are recorded in `app/(shell)/section-headings.test.tsx`
 * and in the comment beside the heading below. Corrected under issue #756,
 * which found this docblock still describing the deleted key.
 *
 * This docblock used to say that most sections list or edit the form itself, so the form's
 * slug was the right `<h1>`. That was true of the builder and was over-generalised to the
 * sections: none of the five screens this component heads is the form, each is one
 * collection belonging to it, and the slug alone gave five sibling screens five identical
 * headings. The one landmark heading a screen reader user navigates by answered "which
 * form" rather than "which page" on every one of them, which is the defect issue #510 fixed
 * one level deeper and left standing here.
 *
 * **The builder is the exception, and it is exempt by construction rather than by
 * omission.** `/forms/[formId]` does not render this component at all: it hand-rolls its
 * heading from `forms.builder.heading`, and it should, because there the page's subject IS
 * the form. So a fix made here reaches exactly the five sections and leaves the builder's
 * bare slug alone. `section-headings.test.tsx` pins both halves of that asymmetry so a
 * later pass at consistency cannot quietly close it.
 *
 * Two routes sit one level deeper still - a single stored version, a single response - and
 * there neither the form nor the section names the subject: two responses of one form were
 * two pages with identical headings (issue #510). Those routes pass `heading`, and the form
 * stays in the rail's Header, which is where context belongs since §7.0.
 */
export function FormPageHeader({
  formId,
  section,
  status,
  heading,
}: {
  readonly formId: string;
  /**
   * The catalog key of the current section, which names the default `<h1>` and the row the
   * rail marks current. One key for both, so a screen cannot end up called one thing in
   * its heading and another in the rail beside it.
   */
  readonly section:
    "builder" | "rules" | "preview" | "versions" | "releases" | "links" | "responses" | "webhooks";
  readonly status?: "open" | "closed";
  /**
   * Overrides the `<h1>` for a route whose subject is one child of the form.
   *
   * The `id` travels with the text because both of this heading's other jobs need it: the
   * component that renders the rest of the page labels its region with the page heading
   * rather than repeating it a level down, and the response route hands focus here after
   * an in-place action. Ids come from `lib/page-headings.ts`.
   */
  readonly heading?: { readonly id: string; readonly text: string };
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* `tabIndex` only with an override: it is a programmatic focus destination, and an
          untargeted heading has no reason to be one. */}
      {/* VISIBLE ON EVERY SECTION SINCE #1116. The default heading was hidden from
          2026-08-26 because the breadcrumb above it had just said the same word; the
          breadcrumb is the rail Header's back link now (§7.0 ruling 3), so this is the one
          place the screen is named in its own column. */}
      {/* THE DEFAULT HEADING CARRIES AN ID TOO (issue #669). It used to have one only when
          a route overrode it, which was enough while every default heading was decoration
          above a breadcrumb that had since said the same word. `/forms/{formId}/rules`
          is the first section screen whose body is a labelled region: the rules editor
          points its `aria-labelledby` at this heading rather than minting a second one,
          because two level-one headings on one screen is the defect, not the fix. Derived
          from the section in `lib/page-headings.ts`, so a section cannot arrive with an id
          nobody wrote. */}
      <h1
        id={heading?.id ?? sectionHeadingId(section)}
        tabIndex={heading === undefined ? undefined : -1}
        className="qcms-ops-title text-xl font-semibold text-(--color-text)"
      >
        {/* THE SECTION'S NAME, WITHOUT THE FORM'S (Code Owner, 2026-08-26). It read
            "Links: kitchen-sink", and the rail one column over says the form's name
            already: the heading was a mashup of two things said elsewhere.

            Issue 679's fix is kept rather than reverted, because its defect was a
            different one. All five section screens used to render the SAME heading - the
            form's slug - so the one landmark heading a screen reader navigates by
            answered "which form" instead of "which page" on every one of them. Five
            distinct headings is what 679 was for, and "Links", "Preview", "Version
            history", "Responses" and "Webhooks" are five distinct headings.

            What this DOES deviate from is the drawing: `preview-versions-poc.html` and
            `responses-poc.html` compose both parts. They were drawn before this rail
            carried the form's name on every one of these screens, and the form's identity
            is still on screen twice - the rail's Header and the form id line below. Ruled
            on by the Code Owner rather than transcribed. */}
        {heading?.text ?? t(`forms.tab.${section}`)}
      </h1>
      {status !== undefined && (
        <p className="text-sm text-(--color-text-muted)">
          {t("forms.builder.formId")}: {formId} · {t("forms.builder.status")}:{" "}
          {t(`forms.status.${status}`)}
        </p>
      )}
    </div>
  );
}
