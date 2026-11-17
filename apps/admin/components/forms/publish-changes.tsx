import { changesSincePublish, type PublishChange } from "@/lib/forms/assist-diff";
import type { DraftForm } from "@/lib/forms/types";
import { t, type MessageKey } from "@/lib/i18n/en";

/** The wizard's read of the draft since the last publish, or why it could not be read. */
export type PublishChangesRead =
  | {
      readonly status: "read";
      readonly base: DraftForm | null;
      readonly draft: DraftForm | null;
      readonly steps: readonly { readonly kind: string; readonly revision: number | null }[];
    }
  | { readonly status: "unread" };

const CHANGE_LABELS: Readonly<Record<PublishChange["change"], MessageKey>> = {
  added: "forms.publish.changes.added",
  changed: "forms.publish.changes.changed",
  removed: "forms.publish.changes.removed",
};

const KIND_LABELS: Readonly<Record<PublishChange["kind"], MessageKey>> = {
  title: "forms.publish.changes.kind.title",
  step: "forms.publish.changes.kind.step",
  question: "forms.publish.changes.kind.question",
  rule: "forms.publish.changes.kind.rule",
};

const STEP_LABELS: Readonly<Record<string, MessageKey>> = {
  "draft.question": "forms.publish.changes.step.draft.question",
  "draft.step": "forms.publish.changes.step.draft.step",
  "draft.rule": "forms.publish.changes.step.draft.rule",
  "draft.copy": "forms.publish.changes.step.draft.copy",
  "draft.appearance": "forms.publish.changes.step.draft.appearance",
  "draft.undo": "forms.publish.changes.step.draft.undo",
  "form.saveDraft": "forms.publish.changes.step.form.saveDraft",
  "apply-draft": "forms.publish.changes.step.apply-draft",
};

function stepLabel(kind: string): string {
  return t(STEP_LABELS[kind] ?? "forms.publish.changes.step.other");
}

/**
 * Every change since the last publish, by anyone, with the assistant's own steps listed
 * beside it: the audit rows say what the assistant did, never what it wrote.
 */
export function PublishChanges({ read }: { readonly read: PublishChangesRead }) {
  if (read.status === "unread") {
    return (
      <p className="text-sm text-(--color-text-muted)" data-testid="qcms-publish-changes">
        {t("forms.publish.changes.unread")}
      </p>
    );
  }
  const changes = read.draft === null ? [] : changesSincePublish(read.base, read.draft);
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="qcms-publish-changes-heading"
      data-testid="qcms-publish-changes"
    >
      <h3 id="qcms-publish-changes-heading" className="text-sm font-semibold">
        {t("forms.publish.changes.heading")}
      </h3>
      {changes.length === 0 ? (
        <p className="text-sm">{t("forms.publish.changes.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm" data-testid="qcms-publish-change-list">
          {changes.map((change) => (
            <li key={`${change.kind}:${change.change}:${change.id}`} data-change={change.change}>
              {`${t(CHANGE_LABELS[change.change])}: ${t(KIND_LABELS[change.kind])} ${change.label}`}
            </li>
          ))}
        </ul>
      )}
      {read.steps.length > 0 && (
        <>
          <h3 className="text-sm font-semibold">{t("forms.publish.changes.assistant")}</h3>
          <p className="text-sm text-(--color-text-muted)">
            {t("forms.publish.changes.assistantNote")}
          </p>
          <ol className="flex flex-col gap-1 text-sm" data-testid="qcms-publish-assistant-steps">
            {read.steps.map((step, index) => (
              <li key={`${step.kind}:${String(index)}`} data-kind={step.kind}>
                {step.revision === null
                  ? stepLabel(step.kind)
                  : t("forms.publish.changes.atRevision", {
                      kind: stepLabel(step.kind),
                      revision: String(step.revision),
                    })}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
