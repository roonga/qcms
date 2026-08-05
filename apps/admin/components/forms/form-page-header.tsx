import { Breadcrumb, type BreadcrumbItem } from "@/components/kit";
import { FormTabs } from "@/components/forms/form-tabs";
import { t } from "@/lib/i18n/en";

/**
 * The chrome every form section shares: breadcrumb, identity line, section nav (034;
 * 035 adds the responses and webhooks sections).
 *
 * A server component, so the sections stay ordinary server-rendered routes and only the
 * nav's current-section highlight needs the client. Keeping it in one place is what stops
 * the builder, preview, history, links, responses and webhooks screens drifting into six
 * slightly different headings for the same form.
 */
export function FormPageHeader({
  formId,
  slug,
  section,
  status,
}: {
  readonly formId: string;
  readonly slug: string;
  /** The catalog key of the current section, used for the last breadcrumb crumb. */
  readonly section: "builder" | "preview" | "versions" | "links" | "responses" | "webhooks";
  readonly status?: "open" | "closed";
}) {
  const crumbs: BreadcrumbItem[] = [
    { id: "forms", label: t("forms.builder.crumbs"), href: "/forms" },
    { id: formId, label: slug, href: `/forms/${encodeURIComponent(formId)}` },
    { id: section, label: t(`forms.tab.${section}`) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Breadcrumb items={crumbs} ariaLabel={t("forms.builder.crumbLabel")} />
      <h1 className="text-xl font-semibold text-(--color-text)">
        {t("forms.builder.heading", { slug })}
      </h1>
      {status !== undefined && (
        <p className="text-sm text-(--color-text-muted)">
          {t("forms.builder.formId")}: {formId} · {t("forms.builder.status")}:{" "}
          {t(`forms.status.${status}`)}
        </p>
      )}
      <FormTabs formId={formId} />
    </div>
  );
}
