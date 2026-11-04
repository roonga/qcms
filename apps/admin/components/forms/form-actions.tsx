"use client";

import Link from "next/link";

import { HeadingMarker } from "@/components/agent/heading-marker";
import type { FormPublishingWorkflow } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/* Close and reopen are the Intake screen's: they act in one environment and a draft has none. */
export function FormActions({
  formId,
  environment,
  workflow,
}: {
  readonly workflow?: FormPublishingWorkflow | undefined;
  readonly formId: string;
  readonly environment: string;
}) {
  const canPublish = workflow?.canPublish !== false;

  return (
    <section
      aria-labelledby="qcms-form-actions-heading"
      className="flex flex-col gap-3"
      data-testid="qcms-form-actions"
    >
      <h2 id="qcms-form-actions-heading" className="qcms-visually-hidden">
        {t("forms.publish.action")}
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        {canPublish && (
          <HeadingMarker control="builder.publish">
            <Link
              className="qcms-button-link"
              data-testid="qcms-publish-entry"
              href={`/forms/${encodeURIComponent(formId)}/publish`}
            >
              {t("forms.versions.publishEntry")}
            </Link>
          </HeadingMarker>
        )}
      </div>

      {workflow?.enabled && !workflow.canPublish && (
        <p className="text-sm text-(--color-text-muted)">
          {t("forms.workflow.noPublishPermission", { environment })}
        </p>
      )}
    </section>
  );
}
