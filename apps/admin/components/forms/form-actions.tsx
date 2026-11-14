"use client";

import Link from "next/link";

import { HeadingMarker } from "@/components/agent/heading-marker";
import { Button } from "@/components/kit";
import type { FormPublishingWorkflow } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

export function FormActions({
  formId,
  workflow,
}: {
  readonly workflow?: FormPublishingWorkflow | undefined;
  readonly formId: string;
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
        {canPublish ? (
          <HeadingMarker control="builder.publish">
            <Link
              className="qcms-button-link"
              data-testid="qcms-publish-entry"
              href={`/forms/${encodeURIComponent(formId)}/publish`}
            >
              {t("forms.versions.publishEntry")}
            </Link>
          </HeadingMarker>
        ) : (
          <span data-testid="qcms-publish-entry-disabled">
            <Button variant="primary" size="md" isDisabled>
              {t("forms.versions.publishEntry")}
            </Button>
          </span>
        )}
      </div>

      {!canPublish && (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-publish-denied">
          {t("forms.workflow.noPublishPermission")}
        </p>
      )}
    </section>
  );
}
