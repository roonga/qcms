import { Breadcrumb, type BreadcrumbItem } from "@/components/kit";
import { t } from "@/lib/i18n/en";

/**
 * The chrome every form section shares: breadcrumb and identity line (034; 035 adds the
 * responses and webhooks sections).
 *
 * A server component, and since issue 561 an entirely static one. Keeping it in one place
 * is what stops the preview, history, links, responses and webhooks screens drifting into
 * five slightly different headings for the same form.
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
 * ## The heading is the form only when the page is about the form
 *
 * Most sections list or edit the form itself, so the form's slug is the right `<h1>`. Two
 * routes sit one level deeper - a single stored version, a single response - and there the
 * slug named the wrong entity: two responses of one form were two pages with identical
 * headings, and the one landmark heading a screen reader user relies on answered "which
 * form" rather than "which page" (issue #510). Those routes pass `heading`, and the form
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
  /** The catalog key of the current section, used for the last breadcrumb crumb. */
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
        {heading?.text ?? t("forms.builder.heading", { slug })}
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
