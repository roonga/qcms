"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";

import { Alert, Button, Dialog } from "@/components/kit";
import { useEnvironmentUnknown } from "@/components/environment-scope";
import type { FormStatusState } from "@/lib/forms/builder-state";
import { IDLE_FORM_STATUS } from "@/lib/forms/builder-state";
import type { FormPublishingWorkflow } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";

/**
 * The form-level actions: the way to the publish wizard, and close/reopen (task 034; screen
 * contract "close/reopen").
 *
 * ## Publishing is not here
 *
 * It was, as two dialogs - publish, and publish-and-release to the screen's environment -
 * and they were a second entry to an act the wizard owns (Code Owner, 2026-10-31: the
 * builder's publish dialogs are retired; the wizard is the only publish entry). What is
 * left here is a link, gated by the same capability the buttons were: a caller who may not
 * publish sees no way to.
 *
 * The things those dialogs taught moved with them rather than being dropped. The freeze
 * summary and the agent-provenance marker are the wizard's review step, computed from the
 * same stored draft. The anchored work list a refusal used to render here is the builder's
 * own validation panel, which lists the same issues: every entry is a link that moves focus
 * to the rule, step or pin at fault, and only this screen renders those - so the wizard
 * names the count and sends the author back here.
 *
 * ## Close and reopen carry their environment
 *
 * The closed state is per (form, environment), so every confirmation names the environment
 * it acts in: an act performed against the wrong environment is not undoable, which is the
 * whole reason Q6 asks for the restatement.
 */
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
  /** Bound by the page to the environment this screen shows; refused if that has changed. */
  readonly setStatus: (action: "close" | "reopen") => Promise<FormStatusState>;
  /**
   * The environment the operator's Q6 switcher had selected when this screen rendered, and
   * the one the lifecycle confirmations name.
   */
  readonly environment: string;
}) {
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const [lifecycle, setLifecycle] = useState<FormStatusState>(IDLE_FORM_STATUS);
  const [isPending, startTransition] = useTransition();
  // Close and reopen act in one environment, so they wait until one is known (A12).
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
          // The same trap as `runPublish`. The dialog stays open here, exactly as it does
          // for a returned failure, because this dialog renders the lifecycle error itself.
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
        {/* The one publish entry (issue #1197). A link rather than a dialog: one
            confirmation can name several destinations, each with its own transition and
            eligibility to read first, and the act writes nothing until its last press. */}
        {canPublish && (
          <Link
            className="qcms-button-link"
            data-testid="qcms-publish-entry"
            href={`/forms/${encodeURIComponent(formId)}/publish`}
          >
            {t("forms.versions.publishEntry")}
          </Link>
        )}
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

      {/* Testid on the region rather than only on its contents, so the `aria-live` can be
          asserted directly (#368; the ops surface got the same treatment in #359). */}
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
            {/* Q6 again, and since task 066 this is the environment the act is **about**
                rather than only the one the operator is reading in: the closed state is per
                (form, environment), so a confirmation that said nothing about where it
                lands would be ambiguous rather than merely unhelpful. */}
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
