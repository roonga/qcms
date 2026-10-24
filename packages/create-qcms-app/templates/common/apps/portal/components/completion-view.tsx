import { HydrationMarker } from "@/components/hydration-marker";
import { LocalDateTime } from "@/components/local-time";
import { PortalShell } from "@/components/portal-shell";
import { t } from "@/lib/i18n/en";

export function CompletionView({
  submittedAt,
  contentHash,
}: {
  readonly submittedAt: string;
  readonly contentHash: string;
}) {
  return (
    <PortalShell>
      <HydrationMarker />
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

        <dl className="flex flex-col gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-background-muted) p-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-(--color-text-muted)">
              {t("completion.submittedAt")}
            </dt>
            <dd className="text-sm text-(--color-text)" data-testid="submitted-at">
              <LocalDateTime iso={submittedAt} />
            </dd>
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
