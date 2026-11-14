import type { ReactNode } from "react";

import { CopyEntityId } from "@/components/copy-entity-id";
import { HelpTip } from "@/components/help-tip";
import type { FormDetail } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { sectionHeadingId } from "@/lib/page-headings";
import { textOf } from "@/lib/questions/definition";
import type { FormSection } from "@/lib/page-title";

/** What the meta line names the form; omitted on a screen whose form read was refused. */
export type FormHeaderSubject = Pick<FormDetail, "slug" | "status" | "draft">;

export function FormPageHeader({
  formId,
  section,
  form,
  heading,
  help,
  actions,
}: {
  readonly formId: string;
  readonly section: FormSection;
  readonly form?: FormHeaderSubject;
  readonly heading?: { readonly id: string; readonly text: string };
  readonly help?: ReactNode;
  /** The screen's own actions, at the row's end: one primary at most, destructive ones in a menu. */
  readonly actions?: ReactNode;
}) {
  const title = form === undefined ? "" : textOf(form.draft?.title ?? undefined).trim();
  return (
    <div className="flex flex-col gap-3">
      <div className="qcms-page-header">
        <div className="qcms-help-head">
          <h1
            id={heading?.id ?? sectionHeadingId(section)}
            tabIndex={heading === undefined ? undefined : -1}
            className="qcms-ops-title text-xl font-semibold text-(--color-text)"
          >
            {heading?.text ?? t(`forms.tab.${section}`)}
          </h1>
          {help === undefined ? null : <HelpTip>{help}</HelpTip>}
        </div>
        {actions === undefined ? null : <div className="qcms-page-header__actions">{actions}</div>}
      </div>
      {form !== undefined && (
        <p className="qcms-form-meta text-sm text-(--color-text-muted)">
          <span className="font-medium text-(--color-text)">
            {title === "" ? form.slug : title}
          </span>
          {title === "" ? null : <span>{form.slug}</span>}
          <span>
            {t("forms.builder.status")}: {t(`forms.status.${form.status}`)}
          </span>
          {/* The whole id is copied rather than painted: a form id derives from an
   author-entered slug, so an abbreviation of one can be another valid id. */}
          <CopyEntityId kind="form" value={formId} display={formId} />
        </p>
      )}
    </div>
  );
}
