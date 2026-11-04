"use client";

import { useCallback, useState, useTransition } from "react";

import { Alert, Button, Dialog } from "@/components/kit";
import { HeadingMarker } from "@/components/agent/heading-marker";
import { useEnvironmentUnknown } from "@/components/environment-scope";
import type { FormStatusState } from "@/lib/forms/builder-state";
import { IDLE_FORM_STATUS } from "@/lib/forms/builder-state";
import { t } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";

/**
 * The intake door: closing one form to new sessions in the selected environment, and
 * reopening it. The closed state is per (form, environment) and an act against the wrong
 * one is not undoable (Q6), so the control carries the environment it acts in.
 */
export function FormIntake({
  slug,
  status,
  setStatus,
  environment,
}: {
  readonly slug: string;
  readonly status: "open" | "closed";
  /** Bound by the page to the environment this screen showed; refused if that has changed. */
  readonly setStatus: (action: "close" | "reopen") => Promise<FormStatusState>;
  /** The environment the operator's Q6 switcher had selected when this screen rendered. */
  readonly environment: string;
}) {
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const [lifecycle, setLifecycle] = useState<FormStatusState>(IDLE_FORM_STATUS);
  const [isPending, startTransition] = useTransition();
  // Close and reopen act in one environment, so they wait until one is known (A12).
  const environmentUnknown = useEnvironmentUnknown();

  const runStatus = useCallback(
    (action: "close" | "reopen") => {
      startTransition(() => {
        void setStatus(action)
          .then((state) => {
            setLifecycle(state);
            if (state.status === "changed") setDialog(null);
          })
          // The dialog stays open on an unexpected rejection exactly as it does for a
          // returned failure, because this dialog renders the lifecycle error itself.
          .catch(() => {
            setLifecycle({ status: "error", message: unexpected() });
          });
      });
    },
    [setStatus],
  );

  return (
    <section
      aria-labelledby="qcms-form-intake-heading"
      className="flex flex-col gap-3"
      data-testid="qcms-form-intake"
    >
      <h2 id="qcms-form-intake-heading" className="qcms-visually-hidden">
        {t("forms.workflow.intake")}
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <HeadingMarker control="intake.door">
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

      {status === "closed" && (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-form-closed">
          {t("forms.lifecycle.closedNote", { environment })}
        </p>
      )}

      {/* Testid on the region, so the `aria-live` can be asserted directly. */}
      <div aria-live="polite" className="flex flex-col gap-2" data-testid="qcms-form-intake-status">
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
            {/* The environment the act is ABOUT rather than only the one being read in:
                the closed state is per (form, environment), so a confirmation that said
                nothing about where it lands would be ambiguous rather than unhelpful. */}
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

/** The verb on a lifecycle dialog's confirm button, naming the environment it acts in. */
function confirmLabel(intent: "close" | "reopen", environment: string): string {
  return intent === "close"
    ? t("forms.lifecycle.confirmClose", { environment })
    : t("forms.lifecycle.confirmReopen", { environment });
}
