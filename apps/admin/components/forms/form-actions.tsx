"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";

import { Alert, Button, Dialog } from "@/components/kit";
import { AgentProvenanceTag } from "@/components/forms/agent-provenance-tag";
import { IssueEntry } from "@/components/forms/validation-panel";
import type { FormStatusState, PublishState } from "@/lib/forms/builder-state";
import { IDLE_FORM_STATUS, IDLE_PUBLISH } from "@/lib/forms/builder-state";
import { freezeSummary, nextVersion } from "@/lib/forms/publish";
import type { DraftForm, FormIssue } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";

/**
 * The form-level actions: publish, and close/reopen (task 034; screen contract
 * "publish dialog" and "close/reopen").
 *
 * ## The dialog is where R1 is taught
 *
 * Publishing is the one irreversible act in the authoring loop, so the confirmation states
 * the consequence rather than asking whether the author is sure: what freezes (their own
 * counts, read back to them), what happens to sessions already under way (they finish on
 * the version they pinned), and what happens next (the following edit starts a fresh
 * draft). Close and reopen carry the same session sentence, because "close" is exactly the
 * word an author is most likely to read as "stop everything".
 *
 * ## The counts come from the stored draft, deliberately
 *
 * Publish freezes the draft the **server** holds, not a document in a browser tab, so the
 * summary is computed from the same stored draft. The builder autosaves, so in practice
 * these are the same document; where they differ, the dialog describes what pressing
 * Publish will actually do, which is the only useful answer.
 *
 * ## A rejected publish is a work list, not an error
 *
 * A 422 comes back carrying the kernel's full `PublishError[]`, each entry addressed by a
 * structured domain path. They render through the builder's own `IssueEntry`, so every one
 * is a link that moves focus to the rule, step or pin that caused it - the same rendering
 * the validation panel gives the same issue, because they are the same issue.
 *
 * That framing explains the visual treatment, and for a while it was also why the outcome
 * was silent: the list rendered outside the live region, so an author pressed Publish,
 * nothing was published, and nothing was said (#377). The region now carries a summary
 * sentence - what happened, and how many issues - while the list stays outside it. Putting
 * the list inside would announce a screenful of links as one flat interruption, at the
 * moment the author most needs to move through them one at a time.
 */
export function FormActions({
  slug,
  formId,
  status,
  draft,
  latestVersion,
  publish,
  setStatus,
  agentAssisted = false,
}: {
  readonly slug: string;
  readonly formId: string;
  readonly status: "open" | "closed";
  readonly draft: DraftForm | null;
  readonly latestVersion: number | undefined;
  readonly publish: () => Promise<PublishState>;
  readonly setStatus: (action: "close" | "reopen") => Promise<FormStatusState>;
  /**
   * Task 041's provenance marker: whether the stored draft this dialog is about to
   * freeze carries any agent-assisted change (ADR-25). Server-sourced, from the same
   * `draftAgentAssisted` the builder reads - this is the human's last look before
   * publishing, so it says what the builder is currently saying, not what it said
   * when the page first loaded.
   */
  readonly agentAssisted?: boolean;
}) {
  const [dialog, setDialog] = useState<"publish" | "close" | "reopen" | null>(null);
  const [published, setPublished] = useState<PublishState>(IDLE_PUBLISH);
  const [lifecycle, setLifecycle] = useState<FormStatusState>(IDLE_FORM_STATUS);
  const [isPending, startTransition] = useTransition();

  const version = nextVersion(latestVersion);
  const summary = freezeSummary(draft);
  const canPublish = draft !== null && summary.steps > 0;

  const runPublish = useCallback(() => {
    startTransition(() => {
      void publish()
        .then((state) => {
          setPublished(state);
          // A rejection keeps the author in the dialog long enough to read that it
          // failed, then hands them the anchored list on the page behind it, where
          // the rules and steps it points at actually are.
          setDialog(null);
        })
        // `.catch` is not defensive decoration. `adminApiFetch` documents that it does not
        // throw for a non-2xx, which is true and is the trap: a transport failure still
        // rejects with a TypeError, and `readResult`'s `response.json()` rejects on a
        // truncated body. Without this the promise rejects unhandled, no state is set,
        // and the dialog sits there looking like a slow network forever.
        //
        // The dialog closes on this path for the same reason the resolved one closes it:
        // the publish result banner lives on the page behind it, so leaving the dialog up
        // would hide the very sentence that says nothing was published.
        .catch(() => {
          setPublished({ status: "error", message: unexpected() });
          setDialog(null);
        });
    });
  }, [publish]);

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
        {t("forms.publish.action")}
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="md"
          isDisabled={!canPublish || isPending}
          onPress={() => {
            setPublished(IDLE_PUBLISH);
            setDialog("publish");
          }}
        >
          {t("forms.publish.action")}
        </Button>
        <Button
          variant="secondary"
          size="md"
          isDisabled={isPending}
          onPress={() => {
            setLifecycle(IDLE_FORM_STATUS);
            setDialog(status === "open" ? "close" : "reopen");
          }}
        >
          {status === "open" ? t("forms.lifecycle.close") : t("forms.lifecycle.reopen")}
        </Button>
      </div>

      {!canPublish && (
        <p className="text-sm text-(--color-text-muted)">{t("forms.publish.noDraft")}</p>
      )}
      {status === "closed" && (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-form-closed">
          {t("forms.lifecycle.closedNote")}
        </p>
      )}

      {/* Testid on the region rather than only on its contents, so the `aria-live` can be
          asserted directly (#368; the ops surface got the same treatment in #359). */}
      <div
        aria-live="polite"
        className="flex flex-col gap-2"
        data-testid="qcms-form-actions-status"
      >
        {/* Publish success and publish error announce from here; a REJECTION did not,
            because `PublishRejection` is a sibling of this region rather than a child of
            it (#377). A summary comes here and the work list stays where it is: every
            entry in it is a link that moves focus to the rule or step at fault, and a list
            of links read out as one flat interruption is neither navigable nor wanted. */}
        {published.status === "rejected" && draft !== null && (
          <p className="qcms-visually-hidden">
            {tPlural(
              "forms.publish.blockedAnnounce.one",
              "forms.publish.blockedAnnounce.other",
              (published.issues ?? []).length,
            )}
          </p>
        )}
        {published.status === "published" && (
          <Alert
            variant="success"
            title={t("forms.publish.published", { version: published.version ?? version })}
          >
            <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(formId)}/versions`}>
              {t("forms.publish.viewHistory")}
            </Link>
          </Alert>
        )}
        {published.status === "error" && (
          <Alert variant="error">
            {t("forms.publish.failed", { message: published.message ?? "" })}
          </Alert>
        )}
        {lifecycle.status === "error" && (
          <Alert variant="error">
            {t("forms.lifecycle.failed", { message: lifecycle.message ?? "" })}
          </Alert>
        )}
      </div>

      {published.status === "rejected" && draft !== null && (
        <PublishRejection issues={published.issues ?? []} draft={draft} />
      )}

      {dialog === "publish" && (
        <Dialog
          isOpen
          role="alertdialog"
          title={t("forms.publish.title", { slug })}
          isDismissable={!isPending}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDialog(null);
          }}
        >
          <div className="flex flex-col gap-4">
            {agentAssisted && (
              <div data-testid="qcms-publish-provenance">
                <AgentProvenanceTag />
              </div>
            )}
            <p className="text-sm text-(--color-text)" data-testid="qcms-freeze-summary">
              {t("forms.publish.freezes", {
                steps: tPlural(
                  "forms.publish.freezes.steps.one",
                  "forms.publish.freezes.steps.other",
                  summary.steps,
                ),
                pins: tPlural(
                  "forms.publish.freezes.pins.one",
                  "forms.publish.freezes.pins.other",
                  summary.pins,
                ),
                rules: tPlural(
                  "forms.publish.freezes.rules.one",
                  "forms.publish.freezes.rules.other",
                  summary.rules,
                ),
              })}
            </p>
            <p className="text-sm text-(--color-text-muted)">
              {t("forms.publish.sessions", { version })}
            </p>
            <p className="text-sm text-(--color-text-muted)">{t("forms.publish.immutable")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="md" isDisabled={isPending} onPress={runPublish}>
                {isPending ? t("forms.publish.pending") : t("forms.publish.confirm", { version })}
              </Button>
              <Button
                variant="ghost"
                size="md"
                isDisabled={isPending}
                onPress={() => {
                  setDialog(null);
                }}
              >
                {t("forms.publish.cancel")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {(dialog === "close" || dialog === "reopen") && (
        <Dialog
          isOpen
          role="alertdialog"
          title={
            dialog === "close"
              ? t("forms.lifecycle.closeTitle", { slug })
              : t("forms.lifecycle.reopenTitle", { slug })
          }
          description={
            dialog === "close" ? t("forms.lifecycle.closeBody") : t("forms.lifecycle.reopenBody")
          }
          isDismissable={!isPending}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDialog(null);
          }}
        >
          <div className="flex flex-col gap-4">
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
                {isPending ? t("forms.lifecycle.pending") : confirmLabel(dialog)}
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

/** The verb on a lifecycle dialog's confirm button. */
function confirmLabel(intent: "close" | "reopen"): string {
  return intent === "close"
    ? t("forms.lifecycle.confirmClose")
    : t("forms.lifecycle.confirmReopen");
}

/** The anchored work list a refused publish leaves behind. Nothing was persisted. */
function PublishRejection({
  issues,
  draft,
}: {
  readonly issues: readonly FormIssue[];
  readonly draft: DraftForm;
}) {
  return (
    <section
      aria-labelledby="qcms-publish-rejected-heading"
      data-testid="qcms-publish-rejected"
      className="flex flex-col gap-2 rounded-md border border-(--color-border-strong) bg-(--color-background-muted) p-4"
    >
      <h3
        id="qcms-publish-rejected-heading"
        className="text-base font-semibold text-(--color-text)"
      >
        {t("forms.publish.blocked")}
      </h3>
      <p className="text-sm text-(--color-text-muted)">
        {t("forms.publish.blockedCount", { count: issues.length })}
      </p>
      <ul className="flex flex-col gap-2">
        {issues.map((issue, index) => (
          <li key={`${issue.code}:${String(index)}`}>
            <IssueEntry issue={issue} draft={draft} />
          </li>
        ))}
      </ul>
    </section>
  );
}
