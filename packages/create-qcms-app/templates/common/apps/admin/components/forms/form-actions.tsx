"use client";

import Link from "next/link";

import { HeadingMarker } from "@/components/agent/heading-marker";
import type { FormPublishingWorkflow } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The form-level action on the builder: the way to the publish wizard (task 034).
 *
 * Publishing is the wizard's, so what is here is a link, gated by the same capability the
 * act is: a caller who may not publish sees no way to. The anchored work list a refusal
 * leaves is the builder's own validation panel, whose entries move focus to the rule, step
 * or pin at fault; only that screen renders those, so the wizard names the count and sends
 * the author back here.
 *
 * CLOSE AND REOPEN LEFT THIS COMPONENT (Code Owner, 2026-11-02). They are operational acts
 * in one environment - the closed state is per (form, environment) - and every per-form
 * operational screen is Operations'. They are `components/ops/form-intake.tsx` now, on
 * `/operations/forms/{formId}/intake`, and the editor is authoring. What went with them is
 * the `lifecycleOnly` mode this component had for the production review, which rendered
 * those two acts and no publish link: with the acts moved it had nothing left to render.
 */
export function FormActions({
  formId,
  environment,
  workflow,
}: {
  readonly workflow?: FormPublishingWorkflow | undefined;
  readonly formId: string;
  /** The environment the operator's Q6 switcher had selected when this screen rendered. */
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
        {/* The one publish entry. A link rather than a dialog: one
            confirmation can name several destinations, each with its own transition and
            eligibility to read first, and the act writes nothing until its last press. */}
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
