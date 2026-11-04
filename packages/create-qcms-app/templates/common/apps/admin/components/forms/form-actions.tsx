"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";

import { Alert, Button, Dialog } from "@/components/kit";
import { HeadingMarker } from "@/components/agent/heading-marker";
import { useEnvironmentUnknown } from "@/components/environment-scope";
import type { FormStatusState } from "@/lib/forms/builder-state";
import { IDLE_FORM_STATUS } from "@/lib/forms/builder-state";
import type { FormPublishingWorkflow } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";

/* Close and reopen act in one environment; carry the environment the confirmation names. */
export function FormActions({
  slug,
  formId,
  status,
  setStatus,
  environment,
  workflow,
  lifecycleOnly = false,
}: {
  readonly lifecycleOnly?: boolean;
  readonly workflow?: FormPublishingWorkflow | undefined;
  readonly slug: string;
  readonly formId: string;
  readonly status: "open" | "closed";
  readonly setStatus: (action: "close" | "reopen") => Promise<FormStatusState>;
  readonly environment: string;
}) {
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const [lifecycle, setLifecycle] = useState<FormStatusState>(IDLE_FORM_STATUS);
  const [isPending, startTransition] = useTransition();
  const environmentUnknown = useEnvironmentUnknown();

  const canPublish = !lifecycleOnly && workflow?.canPublish !== false;

  const runStatus = useCallback(
    (action: "close" | "reopen") => {
      startTransition(() => {
        void setStatus(action)
          .then((state) => {
            setLifecycle(state);
            if (state.status === "changed") setDialog(null);
          })
          .catch(() => {
            setLifecycle({ status: "error", message: unexpected() });
          });
      });
    },
    [setStatus],
  );

  return (
    <section
      aria-labelledby="qcms-form-actions-heading"
      className="flex flex-col gap-3"
      data-testid="qcms-form-actions"
    >
      <h2 id="qcms-form-actions-heading" className="qcms-visually-hidden">
        {t(lifecycleOnly ? "forms.workflow.intake" : "forms.publish.action")}
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
        <HeadingMarker control="builder.intake">
          <Button
            variant="secondary"
            size="md"
            isDisabled={isPending || environmentUnknown}
            onPress={() => {
              setLifecycle(IDLE_FORM_STATUS);
              setDialog(status === "open" ? "close" : "reopen");
            }}
          >
            {status === "open"
              ? t("forms.lifecycle.close", { environment })
              : t("forms.lifecycle.reopen", { environment })}
          </Button>
        </HeadingMarker>
      </div>

      {!lifecycleOnly && workflow?.enabled && !workflow.canPublish && (
        <p className="text-sm text-(--color-text-muted)">
          {t("forms.workflow.noPublishPermission", { environment })}
        </p>
      )}
      {status === "closed" && (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-form-closed">
          {t("forms.lifecycle.closedNote", { environment })}
        </p>
      )}

      <div
        aria-live="polite"
        className="flex flex-col gap-2"
        data-testid="qcms-form-actions-status"
      >
        {lifecycle.status === "error" && (
          <Alert variant="error">
            {t("forms.lifecycle.failed", { message: lifecycle.message ?? "" })}
          </Alert>
        )}
      </div>

      {(dialog === "close" || dialog === "reopen") && (
        <Dialog
          isOpen
          role="alertdialog"
          title={
            dialog === "close"
              ? t("forms.lifecycle.closeTitle", { slug, environment })
              : t("forms.lifecycle.reopenTitle", { slug, environment })
          }
          description={
            dialog === "close"
              ? t("forms.lifecycle.closeBody", { environment })
              : t("forms.lifecycle.reopenBody", { environment })
          }
          isDismissable={!isPending}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDialog(null);
          }}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold" data-testid="qcms-lifecycle-environment">
              {t("environment.inThis", { environment })}
            </p>
            {lifecycle.status === "error" && (
              <Alert variant="error">
                {t("forms.lifecycle.failed", { message: lifecycle.message ?? "" })}
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={dialog === "close" ? "danger" : "primary"}
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  runStatus(dialog);
                }}
              >
                {isPending ? t("forms.lifecycle.pending") : confirmLabel(dialog, environment)}
              </Button>
              <Button
                variant="ghost"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  setDialog(null);
                }}
              >
                {t("forms.lifecycle.cancel")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function confirmLabel(intent: "close" | "reopen", environment: string): string {
  return intent === "close"
    ? t("forms.lifecycle.confirmClose", { environment })
    : t("forms.lifecycle.confirmReopen", { environment });
}
