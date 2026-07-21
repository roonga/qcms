import { PortalShell } from "@/components/portal-shell";
import { t } from "@/lib/i18n/en";

/**
 * Completion receipt (wireframe `/done`): a success card showing the submit
 * response's `submittedAt` and `contentHash`, and "you may close this page" copy.
 * The reference (content hash) is selectable so a respondent can copy it.
 */
export function CompletionView({
  submittedAt,
  contentHash,
}: {
  readonly submittedAt: string;
  readonly contentHash: string;
}) {
  const submittedDisplay = new Date(submittedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <PortalShell>
      <div className="flex flex-col gap-5">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-(--color-success-subtle) text-lg font-semibold text-(--color-success-fg)"
        >
          ✓
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-(--color-text)">{t("completion.title")}</h1>
          <p className="text-sm leading-relaxed text-(--color-text-muted)">
            {t("completion.body")}
          </p>
        </div>

        <dl className="flex flex-col gap-3 rounded-lg border border-(--color-border) bg-(--color-background-muted) p-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-(--color-text-muted)">
              {t("completion.submittedAt")}
            </dt>
            <dd className="text-sm text-(--color-text)">{submittedDisplay} UTC</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-(--color-text-muted)">
              {t("completion.reference")}
            </dt>
            <dd
              className="font-mono text-xs break-all text-(--color-text)"
              data-testid="content-hash"
            >
              {contentHash}
            </dd>
          </div>
        </dl>
      </div>
    </PortalShell>
  );
}
