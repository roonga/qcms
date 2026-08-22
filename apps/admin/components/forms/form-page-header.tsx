import { Breadcrumb, type BreadcrumbItem } from "@/components/kit";
import { t } from "@/lib/i18n/en";

/**
 * The chrome every form section shares: breadcrumb and identity line (034; 035 adds the
 * responses and webhooks sections).
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
 * ## The heading names the page, so it names the section and the form (issue 679)
 *
 * The default `<h1>` composes both: `forms.section.heading` puts the section's name in
 * front of the form's slug, which is what the approved drawings for these screens do
 * (`plan/admin-shell-poc/preview-versions-poc.html` heads its two with "Draft preview:
 * Life insurance" and "Version history: Life insurance"). One template with two
 * placeholders rather than five written sentences, which is ADR-27's reason and not a
 * preference: the section names are already `forms.tab.*` keys, and a preposition form
 * ("Responses to X" but "Links for X") would hand-write English grammar into five strings
 * and make a locale that orders the parts differently rewrite all five.
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
 * stays in the breadcrumb, which is where context belongs.
 */
export function FormPageHeader({
  formId,
  slug,
  section,
  status,
  heading,
}: {
  readonly formId: string;
  readonly slug: string;
  /**
   * The catalog key of the current section, which names both the last breadcrumb crumb and
   * the section half of the default `<h1>`. One key for both, so a section cannot end up
   * called one thing in the breadcrumb and another in the heading above it.
   */
  readonly section: "builder" | "preview" | "versions" | "links" | "responses" | "webhooks";
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
  const crumbs: BreadcrumbItem[] = [
    { id: "forms", label: t("forms.builder.crumbs"), href: "/forms" },
    { id: formId, label: slug, href: `/forms/${encodeURIComponent(formId)}` },
    { id: section, label: t(`forms.tab.${section}`) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Breadcrumb items={crumbs} ariaLabel={t("forms.builder.crumbLabel")} />
      {/* `tabIndex` only with an override: it is a programmatic focus destination, and an
          untargeted heading has no reason to be one. */}
      <h1
        id={heading?.id}
        tabIndex={heading === undefined ? undefined : -1}
        className="qcms-ops-title text-xl font-semibold text-(--color-text)"
      >
        {heading?.text ?? t("forms.section.heading", { section: t(`forms.tab.${section}`), slug })}
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
