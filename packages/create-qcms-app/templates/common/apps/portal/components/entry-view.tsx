import { ChallengeSlot } from "@/components/challenge-slot";
import { HydrationMarker } from "@/components/hydration-marker";
import { PortalShell } from "@/components/portal-shell";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";

export function EntryView({
  title,
  startAction,
}: {
  readonly title: string;
  readonly startAction: string;
}) {
  return (
    <PortalShell>
      <HydrationMarker />
      <div className="flex flex-col gap-5">
        <h1 className="qcms-step-title font-semibold tracking-tight text-(--color-text)">
          {title}
        </h1>
        <p className="text-sm leading-relaxed text-(--color-text-muted)">{t("entry.startHint")}</p>
        <form action={startAction} method="post" className="flex flex-col gap-4">
          <ChallengeSlot />
          <button type="submit" className={buttonClass("primary")}>
            {t("action.start")}
          </button>
        </form>
      </div>
    </PortalShell>
  );
}
